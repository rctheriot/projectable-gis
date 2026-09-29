/**
 * Terrain slope from the USGS 3D Elevation Program, for raster layers.
 *
 * Elevation is fetched once at build time from 3DEP's public ImageServer (no key),
 * requested at exactly the story's base map corners and pixel size so every slope
 * pixel sits on its base map pixel. The raw TIFF is cached in `.cache/`.
 *
 * Slope is computed here rather than taken from the service's own "Slope Degrees"
 * function, so the threshold and the colouring are ours and testable.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fromArrayBuffer } from 'geotiff';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const SERVICE = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer';

/** Below this, a pixel is sea. 3DEP returns ~0m over the ocean rather than no-data. */
export const SEA_LEVEL_METRES = 0.5;

const EARTH_RADIUS = 6378137;
const toMercatorX = (lng) => (EARTH_RADIUS * lng * Math.PI) / 180;
const toMercatorY = (lat) => EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const fromMercatorY = (y) => (Math.atan(Math.exp(y / EARTH_RADIUS)) * 360) / Math.PI - 90;

/**
 * Elevation in metres over the story's corners, as a grid in Web Mercator.
 *
 * @param corners [[W,N],[E,N],[E,S],[W,S]] in degrees
 */
export async function fetchElevation(corners, width, height, cacheDir) {
  const [[west, north], , [east, south]] = corners;
  const bbox = [toMercatorX(west), toMercatorY(south), toMercatorX(east), toMercatorY(north)];

  const params = new URLSearchParams({
    bbox: bbox.join(','),
    bboxSR: '3857',
    imageSR: '3857',
    size: `${width},${height}`,
    format: 'tiff',
    pixelType: 'F32',
    interpolation: 'RSP_BilinearInterpolation',
    f: 'image',
  });
  const url = `${SERVICE}/exportImage?${params}`;

  const key = createHash('sha1').update(url).digest('hex').slice(0, 16);
  const cached = path.join(cacheDir, `3dep-${key}.tif`);
  let bytes;
  if (existsSync(cached)) {
    bytes = await readFile(cached);
  } else {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`3DEP elevation request failed: ${response.status} ${response.statusText}`);
    bytes = Buffer.from(await response.arrayBuffer());
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cached, bytes);
  }

  const tiff = await fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const image = await tiff.getImage();
  if (image.getWidth() !== width || image.getHeight() !== height) {
    throw new Error(`3DEP returned ${image.getWidth()}x${image.getHeight()}, expected ${width}x${height}`);
  }
  const [values] = await image.readRasters();

  return {
    values: Float32Array.from(values),
    width,
    height,
    // Projected metres per pixel. Ground distance is this times cos(latitude).
    pixelX: (bbox[2] - bbox[0]) / width,
    pixelY: (bbox[3] - bbox[1]) / height,
    northY: bbox[3],
    corners,
  };
}

/**
 * Slope in degrees for every pixel, by Horn's method (the 3x3 finite difference
 * GIS tools use). Sea pixels, and the one-pixel frame, are NaN.
 *
 * Web Mercator stretches distance by 1/cos(latitude), so each row's pixel size is
 * scaled back to ground metres; without that, slopes at 21°N read about 7% gentle.
 */
export function slopeDegrees({ values, width, height, pixelX, pixelY, northY }) {
  const slope = new Float32Array(width * height).fill(NaN);
  const at = (x, y) => values[y * width + x];

  for (let y = 1; y < height - 1; y += 1) {
    const latitude = fromMercatorY(northY - (y + 0.5) * pixelY);
    const scale = Math.cos((latitude * Math.PI) / 180);
    const dx = pixelX * scale;
    const dy = pixelY * scale;

    for (let x = 1; x < width - 1; x += 1) {
      if (!(at(x, y) > SEA_LEVEL_METRES)) continue;

      const a = at(x - 1, y - 1), b = at(x, y - 1), c = at(x + 1, y - 1);
      const d = at(x - 1, y), f = at(x + 1, y);
      const g = at(x - 1, y + 1), h = at(x, y + 1), i = at(x + 1, y + 1);

      const dzdx = (c + 2 * f + i - (a + 2 * d + g)) / (8 * dx);
      const dzdy = (g + 2 * h + i - (a + 2 * b + c)) / (8 * dy);
      slope[y * width + x] = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
    }
  }
  return slope;
}

/** Share of land pixels steeper than `threshold` degrees, and the land area in km². */
export function slopeStats(slope, grid, threshold) {
  let land = 0;
  let steep = 0;
  let areaSqm = 0;
  for (let y = 0; y < grid.height; y += 1) {
    const latitude = fromMercatorY(grid.northY - (y + 0.5) * grid.pixelY);
    const scale = Math.cos((latitude * Math.PI) / 180);
    const pixelArea = grid.pixelX * scale * grid.pixelY * scale;
    for (let x = 0; x < grid.width; x += 1) {
      const value = slope[y * grid.width + x];
      if (Number.isNaN(value)) continue;
      land += 1;
      areaSqm += pixelArea;
      if (value > threshold) steep += 1;
    }
  }
  return { steepShare: land ? steep / land : 0, landSqKm: areaSqm / 1e6 };
}

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/**
 * Renders the slope grid to a WebP.
 *
 *   - `steep`: only pixels steeper than `threshold` are drawn, in `color`, as
 *     diagonal hatching over a faint tint -- the cartographic mark for "excluded",
 *     and distinct from every solid fill in the story (government land is also
 *     red). Everything buildable stays transparent.
 *   - `ramp`: every land pixel coloured along `ramp`, flat to `maxValue` degrees.
 */
export async function writeSlopeImage(
  slope,
  grid,
  { outFile, mode, threshold, color, ramp, maxValue, alpha = 200, hatchPeriod = 10, hatchWidth = 4, tintAlpha = 70 },
) {
  const rgba = new Uint8ClampedArray(grid.width * grid.height * 4);
  const steepRgb = color ? hexToRgb(color) : [0, 0, 0];
  const stops = (ramp ?? []).map(hexToRgb);

  for (let p = 0; p < slope.length; p += 1) {
    const value = slope[p];
    if (Number.isNaN(value)) continue;
    const o = p * 4;

    if (mode === 'steep') {
      if (value <= threshold) continue;
      const x = p % grid.width;
      const y = (p - x) / grid.width;
      [rgba[o], rgba[o + 1], rgba[o + 2]] = steepRgb;
      rgba[o + 3] = (x + y) % hatchPeriod < hatchWidth ? alpha : tintAlpha;
      continue;
    }

    const t = Math.min(1, value / maxValue) * (stops.length - 1);
    const lo = Math.floor(t);
    const hi = Math.min(stops.length - 1, lo + 1);
    const k = t - lo;
    for (let c = 0; c < 3; c += 1) rgba[o + c] = stops[lo][c] + (stops[hi][c] - stops[lo][c]) * k;
    rgba[o + 3] = alpha;
  }

  await sharp(rgba, { raw: { width: grid.width, height: grid.height, channels: 4 } })
    .webp({ quality: 85, effort: 5, alphaQuality: 90 })
    .toFile(outFile);
}
