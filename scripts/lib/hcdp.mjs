/**
 * Hawai'i Climate Data Portal raster fetching and colourising.
 *
 * HCDP publishes 250m gridded monthly rainfall for Hawai'i. Unlike the Statewide
 * GIS isohyets -- a single long-term average, drawn as contour lines -- these are
 * actual monthly fields, so the dial can move through time rather than filter a
 * static gradient.
 *
 * Rasters are fetched once at build time and baked into flat WebP images with the
 * colour ramp already applied. The token never leaves this machine and a visitor
 * never touches the upstream API.
 *
 *   GET https://api.hcdp.ikewai.org/raster
 *       Authorization: Bearer <token>
 *       datatype=rainfall&production=new&period=month&date=YYYY-MM&extent=oa
 *   -> GeoTIFF, millimetres, 250m grid
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fromArrayBuffer } from 'geotiff';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const API = 'https://api.hcdp.ikewai.org/raster';
/** Honolulu county, which is Oahu. */
const OAHU_EXTENT = 'oa';

export class MissingTokenError extends Error {}

/**
 * Names this will accept for the HCDP token, in order.
 *
 * `VITE_MESONET_API_KEY` is here because the same credential is used by another
 * app in this group and it is easier to keep one name across both. Note that the
 * `VITE_` prefix has meaning to Vite: it marks a variable as safe to inline into
 * client code. This one is not -- it is read here, in Node, at build time only, and
 * nothing under src/ may reference it. `npm run check:token-leak` proves that.
 */
const TOKEN_NAMES = ['HCDP_API_TOKEN', 'VITE_MESONET_API_KEY', 'MESONET_API_KEY'];

/** Reads the HCDP token from the environment or a .env file. */
export async function readToken(projectRoot) {
  for (const name of TOKEN_NAMES) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }

  const envFile = path.join(projectRoot, '.env');
  if (!existsSync(envFile)) return null;

  const lines = (await readFile(envFile, 'utf8')).split(/\r?\n/);
  for (const name of TOKEN_NAMES) {
    for (const line of lines) {
      const match = new RegExp(`^\\s*${name}\\s*=\\s*(.*)$`).exec(line);
      if (!match) continue;
      // Tolerate quotes, which people add out of habit.
      const value = match[1].trim().replace(/^['"]|['"]$/g, '');
      if (value) return value;
    }
  }
  return null;
}

/** Fetches one month's rainfall GeoTIFF, cached on disk. */
async function fetchRaster(token, date, cacheDir) {
  const cacheFile = path.join(cacheDir, `hcdp-rainfall-${date}.tif`);
  if (existsSync(cacheFile)) return readFile(cacheFile);

  const params = new URLSearchParams({
    datatype: 'rainfall',
    // "new" covers 1990-present; "legacy" is 1920-2012.
    production: 'new',
    period: 'month',
    date,
    extent: OAHU_EXTENT,
  });

  const response = await fetch(`${API}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 401 || response.status === 403) {
    throw new MissingTokenError('HCDP rejected the token (401/403). Check HCDP_API_TOKEN in .env.');
  }
  // A month that has not been published yet is not an error worth stopping for:
  // the "new" production rainfall maps lag real time by a month or two.
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`HCDP returned ${response.status} for ${date}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cacheFile, buffer);
  return buffer;
}

/**
 * Turns a single-band float raster into an RGBA image using a colour ramp.
 *
 * Cells with no data -- everything off the island -- become fully transparent, so
 * the rainfall field sits on the terrain rather than in a box around it.
 */
function colourise(values, width, height, noData, ramp, maxValue) {
  const rgba = Buffer.alloc(width * height * 4);

  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    const offset = i * 4;

    if (value === noData || !Number.isFinite(value) || value < 0) continue; // transparent

    // Square root keeps the dry end readable: rainfall is very skewed, and a
    // linear ramp spends most of its range on a handful of wet ridge cells.
    const t = Math.min(1, Math.sqrt(Math.max(0, value) / maxValue));
    const scaled = t * (ramp.length - 1);
    const low = Math.floor(scaled);
    const high = Math.min(ramp.length - 1, low + 1);
    const mix = scaled - low;

    for (let c = 0; c < 3; c += 1) {
      rgba[offset + c] = Math.round(ramp[low][c] * (1 - mix) + ramp[high][c] * mix);
    }
    // Fade the driest cells out rather than laying a flat wash over the island.
    rgba[offset + 3] = Math.round(255 * (0.25 + 0.75 * t));
  }

  return rgba;
}

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** Reads one month's grid without rendering it. */
export async function readRainfall(token, date, cacheDir) {
  const buffer = await fetchRaster(token, date, cacheDir);
  if (!buffer) return null;

  const tiff = await fromArrayBuffer(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  );
  const image = await tiff.getImage();
  const [values] = await image.readRasters();
  const width = image.getWidth();
  const height = image.getHeight();
  const [west, south, east, north] = image.getBoundingBox();

  // GDAL writes nodata in the file directives; fall back to the usual sentinel.
  const declared = image.getFileDirectory().GDAL_NODATA;
  const noData = declared !== undefined ? Number.parseFloat(declared) : -9999;

  return {
    values,
    width,
    height,
    noData,
    corners: [[west, north], [east, north], [east, south], [west, south]],
  };
}

/** Sums several months cell by cell, preserving the nodata mask. */
export function sumGrids(grids) {
  const [first] = grids;
  const total = new Float32Array(first.values.length);

  for (let i = 0; i < total.length; i += 1) {
    let sum = 0;
    let any = false;
    for (const grid of grids) {
      const value = grid.values[i];
      if (value === grid.noData || !Number.isFinite(value) || value < 0) continue;
      sum += value;
      any = true;
    }
    total[i] = any ? sum : -9999;
  }

  return { values: total, width: first.width, height: first.height, noData: -9999, corners: first.corners };
}

/** Renders a grid to a colourised WebP. */
export async function writeRainfallImage(grid, { outFile, ramp, maxValue }) {
  let peak = 0;
  for (const value of grid.values) {
    if (value !== grid.noData && Number.isFinite(value) && value > peak) peak = value;
  }

  const rgba = colourise(grid.values, grid.width, grid.height, grid.noData, ramp.map(hexToRgb), maxValue);

  await sharp(rgba, { raw: { width: grid.width, height: grid.height, channels: 4 } })
    .webp({ quality: 85, effort: 5, alphaQuality: 90 })
    .toFile(outFile);

  return peak;
}
