/**
 * "Oahu and the Rising Sea".
 *
 * Built entirely from public data published by the Hawai'i Statewide GIS Program,
 * fetched once at build time and served from our own site -- visitors never touch
 * the upstream service.
 *
 *   Sea level rise layers  geodata.hawaii.gov/arcgis/rest/services/Climate/MapServer
 *   Tsunami zones          geodata.hawaii.gov/arcgis/rest/services/Hazards/MapServer
 *
 * The dial is the sea level itself, in tenths of a foot, rather than a year. The
 * State's four published scenarios (0.5, 1.1, 2.0 and 3.2 ft) were originally tied
 * to 2100; the 2022 guidance revised the timing without republishing the maps, so
 * pinning a year to each footprint would be inventing precision the data does not
 * have. The levels are shown for what they are, and the timing is described in
 * words where it belongs.
 */
import path from 'node:path';
import { PROJECT_ROOT } from './paths.mjs';

const CLIMATE = 'https://geodata.hawaii.gov/arcgis/rest/services/Climate/MapServer';
const HAZARDS = 'https://geodata.hawaii.gov/arcgis/rest/services/Hazards/MapServer';

/** Oahu, with a margin for the offshore edges of the hazard polygons. */
const OAHU_BBOX = [-158.31, 21.23, -157.62, 21.73];

/**
 * 5m is far below what a projector can resolve on a 3x2m table, and it takes the
 * exposure layer from 23MB to about 1MB. Parts under 500 m^2 are slivers.
 */
const SIMPLIFY = { toleranceMetres: 5, minAreaSqm: 500 };
const SIMPLIFY_LINES = { toleranceMetres: 5 };

/** The four published scenarios, in feet. */
const LEVELS = [0.5, 1.1, 2.0, 3.2];

/**
 * Each layer gets its own hue; the level is encoded *within* that hue.
 *
 * Two things need distinguishing at once here, and they are different kinds of
 * thing. Which dataset you are looking at is an identity -- exposure, passive
 * flooding, waves, erosion, highways -- and identity is carried by hue. How much
 * sea level rise a feature turns on at is a magnitude, and magnitude is carried by
 * lightness within the hue: lightest floods soonest, darkest only at 3.2 ft.
 *
 * Sharing one blue ramp across four layers, as this story first did, meant turning
 * on exposure and passive flooding together produced a single indistinguishable
 * wash. The seven base hues below are checked as a categorical palette against the
 * dark projector surface -- lightness band, chroma floor, colour-vision separation
 * and contrast -- and each ramp is a sequential scale inside its own hue.
 */
const HUES = {
  exposure: { base: '#4A86E8', ramp: ['#70A7FF', '#5891F0', '#437CD8', '#3669BC'] },
  passive: { base: '#3FA97F', ramp: ['#6FC6A0', '#51B38A', '#389D76', '#2C8864'] },
  waves: { base: '#8878F0', ramp: ['#A69BFF', '#9284F8', '#7E6FE0', '#6C5DC3'] },
  erosion: { base: '#D0609E', ramp: ['#EB86BB', '#DA6DA8', '#C25893', '#A8497E'] },
  highways: { base: '#A2941F', ramp: ['#BFB358', '#AC9F37', '#978919', '#82760D'] },
};

/** Tsunami zones are static, so a single hue each. */
const TSUNAMI = {
  extreme: { base: '#CE4A6B', outline: '#EE8AA3' },
  standard: { base: '#C2842F', outline: '#E3B268' },
};

const stops = (ramp) =>
  ramp.map((color, index) => ({ value: LEVELS[index], color, label: `${LEVELS[index]} ft` }));

/** Builds the four-scenario variant list for a themed set of upstream layers. */
const scenarioVariants = (layerIds) =>
  layerIds.map((layer, index) => ({ layer, properties: { slr_ft: LEVELS[index] } }));

const thresholdLayer = (id, name, description, layerIds, hue, options = {}) => ({
  id,
  name,
  description,
  render: options.render ?? 'fill',
  color: HUES[hue].base,
  opacity: options.opacity ?? 0.8,
  lineWidth: options.lineWidth,
  defaultActive: options.defaultActive ?? false,
  remote: {
    service: CLIMATE,
    variants: scenarioVariants(layerIds),
    where: '1=1',
    bbox: OAHU_BBOX,
    simplify: options.render === 'line' ? SIMPLIFY_LINES : SIMPLIFY,
    // Widest footprint first, so nearer-term bands sit on top of it.
    sortBy: { property: 'slr_ft', direction: 'desc' },
  },
  fill: {
    type: 'threshold',
    property: 'slr_ft',
    dialScale: 0.1,
    levels: stops(HUES[hue].ramp),
  },
});

const STORY = {
  id: 'oahu-sea-level',
  title: 'Oahu and the Rising Sea',
  subtitle: 'Which ground goes under, and which is already a tsunami evacuation zone',

  // A tsunami evacuation sign: the hazard Oahu already signs for, which is where
  // this story starts before the water gets higher.
  cover: 'assets/covers/oahu-sea-level.png',
  /*
   * Anchored to the top, not the centre. The sign sits high in the frame, so a
   * centred 16:9 crop drops sky from above it and leaves it at 26% from the top of
   * the card; keeping the top puts it at 43%, which reads as centred. Truly
   * centring it would need sky the photograph does not contain.
   */
  coverPosition: 'top',

  // The base raster is the one the energy story already ships, so this story adds
  // no new imagery and does not depend on the retired Angular assets.
  sourceDir: PROJECT_ROOT,
  source: { baseMap: path.join('public', 'stories', 'oahu-energy', 'base-map.webp') },
  corners: [
    [-158.281, 21.71],
    [-157.647, 21.71],
    [-157.647, 21.252],
    [-158.281, 21.252],
  ],

  // Tenths of a foot: 0.0 through 3.2 ft.
  years: { min: 0, max: 32 },
  dial: { label: 'Sea level rise', scale: 0.1, decimals: 1, unit: 'ft' },

  scenarios: [
    {
      id: 'slr-xa',
      name: 'State exposure area',
      description:
        "Hawai'i Sea Level Rise Vulnerability and Adaptation Report modelling. The 3.2 ft exposure area remains the State's recommended planning layer.",
    },
  ],

  palette: {},
  seriesOrder: [],
  dataSources: [],
  charts: [],

  pucks: [
    { markerId: 0, label: 'Sea level', action: { type: 'year', step: 1 }, degreesPerStep: 10, color: '#45A8E0' },
    { markerId: 1, label: 'Layer', action: { type: 'select-layer' }, degreesPerStep: 30, color: '#38A6A5' },
    { markerId: 2, label: 'Add / Remove', action: { type: 'toggle-layer' }, degreesPerStep: 45, color: '#E8A33D' },
  ],
};

const LAYERS = [
  /*
   * The extreme zone is declared first so it sits *underneath* the standard one.
   * It is the larger of the two and contains it, so painting it on top would hide
   * the zone people are actually told to evacuate.
   *
   * Both carry a bright outline. A zone boundary is the thing that matters -- "am I
   * inside it" -- and a fill alone has to be opaque enough to obscure the terrain
   * before the edge reads reliably against a satellite photo.
   */
  {
    id: 'tsunami-extreme',
    name: 'Extreme Tsunami Evacuation Zone',
    description:
      'The larger zone for a rare, worst-case Aleutian-source event. Roughly twice the area of the standard zone in places.',
    render: 'fill',
    color: TSUNAMI.extreme.base,
    outlineColor: TSUNAMI.extreme.outline,
    outlineOpacity: 0.9,
    lineWidth: 1.5,
    opacity: 0.45,
    remote: {
      service: HAZARDS,
      variants: [{ layer: 12 }],
      where: "island='OAHU'",
      bbox: OAHU_BBOX,
      simplify: SIMPLIFY,
    },
    fill: { type: 'static' },
  },
  {
    id: 'tsunami-evacuation',
    name: 'Tsunami Evacuation Zone',
    description:
      'Where to leave during a tsunami warning. This is a hazard Oahu already lives with, mapped independently of sea level rise -- useful as the baseline the rising water is measured against.',
    render: 'fill',
    color: TSUNAMI.standard.base,
    outlineColor: TSUNAMI.standard.outline,
    outlineOpacity: 0.9,
    lineWidth: 1.5,
    opacity: 0.55,
    remote: {
      service: HAZARDS,
      variants: [{ layer: 2 }],
      where: "island='OAHU'",
      bbox: OAHU_BBOX,
      simplify: SIMPLIFY,
    },
    fill: { type: 'static' },
  },

  thresholdLayer(
    'slr-exposure',
    'Sea Level Rise Exposure',
    "The State's combined chronic flooding footprint: passive flooding, annual high wave flooding and coastal erosion together. This is the layer Hawai'i plans against.",
    [42, 43, 44, 45],
    'exposure',
    { defaultActive: true },
  ),
  thresholdLayer(
    'slr-passive',
    'Passive Flooding',
    'Ground simply below the tide line -- water arriving with nothing to stop it. One of the three components of the exposure area.',
    [46, 49, 50, 51],
    'passive',
  ),
  thresholdLayer(
    'slr-waves',
    'Annual High Wave Flooding',
    'Reach of the highest waves in a typical year, on top of the raised sea. This is what puts water well inland of the passive flooding line on exposed coasts.',
    [52, 53, 54, 55],
    'waves',
  ),
  thresholdLayer(
    'slr-erosion',
    'Coastal Erosion',
    'Land projected to be lost to shoreline retreat, not merely flooded. This ground does not come back at low tide.',
    [60, 61, 62, 63],
    'erosion',
  ),
  thresholdLayer(
    'slr-highways',
    'Flooded Highways',
    'State highway segments within the exposure area. Oahu’s coastal highways are single points of failure for whole communities -- losing a segment can cut off far more than it floods.',
    [68, 69, 70, 71],
    'highways',
    { render: 'line', lineWidth: 4, opacity: 1 },
  ),
];

export const oahuSeaLevel = { ...STORY, layers: LAYERS };
