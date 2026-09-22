/**
 * Builds a runtime story bundle from the legacy Angular assets.
 *
 * This is a one-shot data migration, not part of `vite build`. It:
 *   1. downscales the base raster to fit the GPU texture limit,
 *   2. trims GeoJSON to the properties each layer actually uses and rounds
 *      coordinates to ~10cm, which is where most of the 158MB goes,
 *   3. precomputes buildout rank/prefix-sums and per-year choropleth values, so
 *      nothing is recomputed in the browser when the year changes,
 *   4. emits a single declarative story.json.
 *
 * Usage: npm run prepare-story [-- --only <story id>] [-- --source <assets dir>]
 */
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { annotateBuildout } from './lib/buildout.mjs';
import { simplifyFeatures } from './lib/simplify.mjs';
import { PROJECT_ROOT } from './lib/paths.mjs';
import { STORIES } from './lib/stories.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

/** Most integrated GPUs driving projectors cap textures at 4096px. */
const MAX_TEXTURE_SIZE = 4096;
/** ~11cm at the equator. Plenty for parcel polygons on a 3x2m table. */
const COORD_PRECISION = 6;

/** Raw upstream responses, so iterating on a story does not re-download them. */
const CACHE_DIR = path.join(PROJECT_ROOT, '.cache');

/**
 * Server-side generalization tolerance, in degrees. ~2.2m at Oahu's latitude, well
 * under the 5m we simplify to ourselves.
 */
const GENERALIZE_DEGREES = 0.00002;

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? null : args[index + 1];
};
const only = flag('only');
const sourceOverride = flag('source');

const log = (...parts) => console.log(...parts);
const mb = (bytes) => `${(bytes / 1e6).toFixed(1)}MB`;

function roundCoords(node) {
  if (typeof node[0] === 'number') {
    for (let i = 0; i < node.length; i += 1) {
      node[i] = Math.round(node[i] * 10 ** COORD_PRECISION) / 10 ** COORD_PRECISION;
    }
    return;
  }
  for (const child of node) roundCoords(child);
}

function trimProperties(feature, keep) {
  const kept = {};
  for (const key of keep) {
    if (feature.properties?.[key] !== undefined) kept[key] = feature.properties[key];
  }
  feature.properties = kept;
  delete feature.id;
  delete feature.bbox;
}

/**
 * Downloads one ArcGIS feature layer as GeoJSON, clipped to a bounding box.
 *
 * Responses are cached on disk. These are tens of megabytes each and the upstream
 * service is a public agency's -- there is no reason to ask for the same bytes
 * twice while iterating on a story.
 */
async function fetchArcGis(service, layerId, { where = '1=1', bbox, outFields = '', offset = GENERALIZE_DEGREES }) {
  const cacheKey = `${service}/${layerId}/${where}/${(bbox ?? []).join(',')}/${outFields}/${offset}`;
  const cacheFile = path.join(
    CACHE_DIR,
    `${createHash('sha1').update(cacheKey).digest('hex').slice(0, 16)}.geojson`,
  );

  if (existsSync(cacheFile)) {
    return JSON.parse(await readFile(cacheFile, 'utf8'));
  }

  const params = new URLSearchParams({
    where,
    outSR: '4326',
    returnGeometry: 'true',
    // Trimming at the source keeps the download to what we will actually keep.
    geometryPrecision: '6',
    /*
     * Ask the server to generalize before sending. Without this the 3.2 ft passive
     * flooding layer simply fails with a 500 -- the full-precision geometry is too
     * large to serialize -- and everything else takes far longer than it needs to.
     * The offset is well below our own simplification tolerance, so nothing visible
     * is lost.
     */
    maxAllowableOffset: String(offset),
    outFields: outFields || 'OBJECTID',
    f: 'geojson',
  });

  if (bbox) {
    params.set(
      'geometry',
      JSON.stringify({
        xmin: bbox[0],
        ymin: bbox[1],
        xmax: bbox[2],
        ymax: bbox[3],
        spatialReference: { wkid: 4326 },
      }),
    );
    params.set('geometryType', 'esriGeometryEnvelope');
    params.set('spatialRel', 'esriSpatialRelIntersects');
  }

  const url = `${service}/${layerId}/query?${params}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${service}/${layerId} returned ${response.status}`);

  const text = await response.text();
  let geojson;
  try {
    geojson = JSON.parse(text);
  } catch {
    throw new Error(`${service}/${layerId} did not return JSON: ${text.slice(0, 200)}`);
  }
  if (geojson.error) throw new Error(`${service}/${layerId}: ${geojson.error.message}`);

  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cacheFile, JSON.stringify(geojson));
  return geojson;
}

/**
 * Builds one layer from remote sources.
 *
 * A layer may be assembled from several published datasets -- each sea level rise
 * scenario is its own layer upstream -- which are tagged with the properties that
 * distinguish them and concatenated into one file, so the runtime needs a single
 * source and a single paint expression.
 */
async function fetchRemoteFeatures(layer) {
  const remote = layer.remote;
  if (remote.generalizeDegrees === undefined) remote.generalizeDegrees = GENERALIZE_DEGREES;
  const features = [];

  for (const variant of remote.variants) {
    const geojson = await fetchArcGis(remote.service, variant.layer, {
      where: variant.where ?? remote.where,
      bbox: remote.bbox,
      outFields: remote.outFields,
      offset: remote.generalizeDegrees,
    });

    for (const feature of geojson.features ?? []) {
      if (!feature.geometry) continue;
      feature.properties = { ...(remote.keepFrom ? feature.properties : {}), ...variant.properties };
      features.push(feature);
    }
  }

  // Draw order within the file: the widest footprint first, so narrower, nearer-term
  // bands sit on top of it rather than being buried.
  if (remote.sortBy) {
    const { property, direction } = remote.sortBy;
    const sign = direction === 'desc' ? -1 : 1;
    features.sort((a, b) => sign * ((a.properties[property] ?? 0) - (b.properties[property] ?? 0)));
  }

  return features;
}

function parseCsv(text) {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(',').map((h) => h.trim());
  return lines.filter(Boolean).map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(headers.map((h, i) => [h, cells[i]?.trim()]));
  });
}

// ---------------------------------------------------------------------------

async function buildBaseMap(story, SOURCE, OUT) {
  const src = path.join(SOURCE, story.source.baseMap);
  const image = sharp(src);
  const { width, height } = await image.metadata();

  const scale = Math.min(1, MAX_TEXTURE_SIZE / Math.max(width, height));
  const outWidth = Math.round(width * scale);
  const outHeight = Math.round(height * scale);
  const dest = path.join(OUT, 'base-map.webp');

  await image
    .resize(outWidth, outHeight, { fit: 'fill' })
    .webp({ quality: 88, effort: 5 })
    .toFile(dest);

  const before = (await readFile(src)).byteLength;
  const after = (await readFile(dest)).byteLength;
  log(
    `  base-map  ${width}x${height} -> ${outWidth}x${outHeight}  ${mb(before)} -> ${mb(after)}` +
      (scale < 1 ? `  (capped at ${MAX_TEXTURE_SIZE}px for GPU texture limit)` : ''),
  );

  return { image: `stories/${story.id}/base-map.webp`, width: outWidth, height: outHeight };
}

async function buildJoinTable(join, SOURCE) {
  const rows = parseCsv(await readFile(path.join(SOURCE, join.source), 'utf8'));
  const table = new Map();
  for (const row of rows) {
    const key = String(row[join.columns.key]);
    if (!table.has(key)) table.set(key, new Map());
    table.get(key).set(String(row[join.columns.year]), Number(row[join.columns.value]));
  }
  return table;
}

async function buildLayer(story, layer, joinTables, SOURCE, OUT) {
  let geojson;
  let features;
  let rawBytes = 0;

  if (layer.remote) {
    features = await fetchRemoteFeatures(layer);
    rawBytes = JSON.stringify(features).length;
    geojson = { type: 'FeatureCollection', features };
  } else {
    const src = path.join(SOURCE, layer.source);
    const raw = await readFile(src);
    rawBytes = raw.byteLength;
    geojson = JSON.parse(raw.toString('utf8'));
    features = geojson.features.filter((f) => f?.geometry);

    const keep = new Set(layer.keepProperties ?? []);
    for (const feature of features) trimProperties(feature, keep);
  }

  let note = '';

  // Published hazard data is at survey precision -- far finer than a projector
  // pixel -- so it is thinned once, here, rather than shipped to every visitor.
  const simplify = layer.remote?.simplify ?? layer.simplify;
  if (simplify) {
    const stats = simplifyFeatures(features, simplify);
    features = stats.features;
    geojson.features = features;
    note = `  simplified: ${stats.before} -> ${stats.after} pts, ${stats.partsBefore} -> ${stats.partsAfter} parts`;
  }

  for (const feature of features) roundCoords(feature.geometry.coordinates);

  if (layer.fill.type === 'buildout') {
    const stats = annotateBuildout(features, layer.fill, `layer "${layer.id}"`);
    // Recorded on the layer so the legend can report progress against it.
    layer.buildoutTotal = stats.total;
    note =
      `  buildout: ${stats.count} features, capacity ${stats.total.toExponential(3)}` +
      (stats.excluded ? `, ${stats.excluded} excluded` : '');
  }

  if (layer.fill.type === 'joined-choropleth') {
    const table = joinTables.get(layer.fill.join);
    const firstYear = layer.fill.firstYear ?? story.years.min;
    let matched = 0;
    for (const feature of features) {
      const rawKey = String(feature.properties[layer.fill.featureKey] ?? '');
      const key = layer.fill.keyTransform === 'after-underscore' ? rawKey.split('_')[1] : rawKey;
      const series = table.get(key);
      if (!series) continue;
      matched += 1;
      for (let year = firstYear; year <= story.years.max; year += 1) {
        const value = series.get(String(year));
        if (value !== undefined) feature.properties[`y${year}`] = value;
      }
      // The join key is only needed at build time.
      delete feature.properties[layer.fill.featureKey];
    }
    note = `  joined: ${matched}/${features.length} features matched`;
  }

  geojson.features = features;
  delete geojson.crs;

  const dest = path.join(OUT, 'layers', `${layer.id}.geojson`);
  await writeFile(dest, JSON.stringify(geojson));
  const after = (await readFile(dest)).byteLength;
  log(`  ${layer.id.padEnd(18)} ${mb(rawBytes).padStart(7)} -> ${mb(after).padStart(7)}${note}`);

  return `stories/${story.id}/layers/${layer.id}.geojson`;
}

async function buildStory(story) {
  const SOURCE = path.resolve(sourceOverride ?? story.sourceDir ?? PROJECT_ROOT);
  const OUT = path.join(PROJECT_ROOT, 'public', 'stories', story.id);

  if (story.sourceDir && !existsSync(SOURCE)) {
    throw new Error(`Assets for "${story.id}" not found at ${SOURCE}. Pass --source <dir>.`);
  }

  log(`\nBuilding "${story.id}" from ${SOURCE}\n`);
  await rm(OUT, { recursive: true, force: true });
  await mkdir(path.join(OUT, 'layers'), { recursive: true });
  await mkdir(path.join(OUT, 'data'), { recursive: true });
  await mkdir(path.join(OUT, 'icons'), { recursive: true });

  const baseMap = story.source?.baseMap
    ? await buildBaseMap(story, SOURCE, OUT)
    : { image: story.baseMapImage, width: story.baseMapWidth, height: story.baseMapHeight };

  const joinTables = new Map();
  for (const join of story.source?.joins ?? []) {
    joinTables.set(join.id, await buildJoinTable(join, SOURCE));
  }

  log('\n  layer            before      after');
  const layerPaths = new Map();
  for (const layer of story.layers) {
    layerPaths.set(layer.id, await buildLayer(story, layer, joinTables, SOURCE, OUT));
  }

  log('');
  for (const source of story.dataSources ?? []) {
    await copyFile(path.join(SOURCE, source.source), path.join(OUT, 'data', `${source.id}.csv`));
  }
  log(`  copied ${(story.dataSources ?? []).length} data series`);

  let icons = 0;
  for (const layer of story.layers) {
    if (!layer.icon || layer.remote) continue;
    const src = path.join(SOURCE, layer.icon);
    if (!existsSync(src)) continue;
    await sharp(src)
      .resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toFile(path.join(OUT, 'icons', `${layer.id}.png`));
    icons += 1;
  }
  log(`  wrote ${icons} icons`);

  const bundle = {
    id: story.id,
    title: story.title,
    subtitle: story.subtitle,
    years: story.years,
    scenarios: story.scenarios,
    baseMap: { ...baseMap, corners: story.corners },
    palette: story.palette,
    seriesOrder: story.seriesOrder,
    dial: story.dial,
    dataSources: (story.dataSources ?? []).map(({ id, unit, columns }) => ({
      id,
      unit,
      columns,
      path: `stories/${story.id}/data/${id}.csv`,
    })),
    charts: story.charts,
    pucks: story.pucks,
    layers: story.layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      description: layer.description,
      data: layerPaths.get(layer.id),
      icon: layer.icon && !layer.remote ? `stories/${story.id}/icons/${layer.id}.png` : undefined,
      render: layer.render,
      fill: layer.fill,
      color: layer.color,
      outlineColor: layer.outlineColor,
      lineWidth: layer.lineWidth,
      opacity: layer.opacity,
      outlineOpacity: layer.outlineOpacity,
      defaultActive: layer.defaultActive,
      buildoutTotal: layer.buildoutTotal,
    })),
  };

  await writeFile(path.join(OUT, 'story.json'), JSON.stringify(bundle, null, 2));
  log(`\n  wrote ${path.relative(PROJECT_ROOT, OUT)}/story.json`);

  return {
    id: story.id,
    title: story.title,
    subtitle: story.subtitle,
    coverImage: baseMap.image,
    path: `stories/${story.id}/story.json`,
  };
}

async function main() {
  const selected = only ? STORIES.filter((s) => s.id === only) : STORIES;
  if (selected.length === 0) {
    throw new Error(`No story matches "${only}". Known: ${STORIES.map((s) => s.id).join(', ')}.`);
  }

  const index = [];
  for (const story of selected) index.push(await buildStory(story));

  // Building a subset must not drop the others from the index, so entries for
  // stories that are already on disk are preserved.
  const indexPath = path.join(PROJECT_ROOT, 'public', 'stories', 'index.json');
  if (only && existsSync(indexPath)) {
    const existing = JSON.parse(await readFile(indexPath, 'utf8'));
    for (const entry of existing) {
      if (!index.some((e) => e.id === entry.id)) index.push(entry);
    }
  }
  index.sort((a, b) => a.title.localeCompare(b.title));

  await mkdir(path.dirname(indexPath), { recursive: true });
  await writeFile(indexPath, JSON.stringify(index, null, 2));
  log(`\nIndexed ${index.length} ${index.length === 1 ? 'story' : 'stories'}.`);
}

main().catch((error) => {
  console.error(`\nBuild failed: ${error.message}`);
  process.exit(1);
});
