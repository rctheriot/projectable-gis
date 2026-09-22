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
 * A sequential ramp: one hue, light to dark. Brightest floods first, so the bright
 * core reads as "soonest" and the dark outer band as "only at 3.2 ft".
 */
const LEVEL_COLORS = ['#7FD4F5', '#45A8E0', '#2C7BC0', '#1F4E96'];

/**
 * The highways ramp is warm, not blue.
 *
 * A threshold layer colours by level, so linework sharing the exposure area's ramp
 * disappears into the water it is drawn on top of. Same encoding -- brightest
 * floods soonest -- in a hue that survives the background.
 */
const HIGHWAY_COLORS = ['#F7E06E', '#F5C542', '#E89B2F', '#C9701C'];

const stops = (colors) =>
  colors.map((color, index) => ({ value: LEVELS[index], color, label: `${LEVELS[index]} ft` }));

const levelStops = stops(LEVEL_COLORS);

/** Builds the four-scenario variant list for a themed set of upstream layers. */
const scenarioVariants = (layerIds) =>
  layerIds.map((layer, index) => ({ layer, properties: { slr_ft: LEVELS[index] } }));

const thresholdLayer = (id, name, description, layerIds, options = {}) => ({
  id,
  name,
  description,
  render: options.render ?? 'fill',
  color: options.color ?? LEVEL_COLORS[3],
  opacity: options.opacity ?? 0.75,
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
    levels: options.levels ?? levelStops,
  },
});

const STORY = {
  id: 'oahu-sea-level',
  title: 'Oahu and the Rising Sea',
  subtitle: 'Which ground goes under, and which is already a tsunami evacuation zone',

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
  {
    id: 'tsunami-evacuation',
    name: 'Tsunami Evacuation Zone',
    description:
      'Where to leave during a tsunami warning. This is a hazard Oahu already lives with, mapped independently of sea level rise -- useful as the baseline the rising water is measured against.',
    render: 'fill',
    color: '#E8A33D',
    opacity: 0.35,
    remote: {
      service: HAZARDS,
      variants: [{ layer: 2 }],
      where: "island='OAHU'",
      bbox: OAHU_BBOX,
      simplify: SIMPLIFY,
    },
    fill: { type: 'static' },
  },
  {
    id: 'tsunami-extreme',
    name: 'Extreme Tsunami Evacuation Zone',
    description:
      'The larger zone for a rare, worst-case Aleutian-source event. Roughly twice the area of the standard zone in places.',
    render: 'fill',
    color: '#D2604A',
    opacity: 0.3,
    remote: {
      service: HAZARDS,
      variants: [{ layer: 12 }],
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
    { defaultActive: true },
  ),
  thresholdLayer(
    'slr-passive',
    'Passive Flooding',
    'Ground simply below the tide line -- water arriving with nothing to stop it. One of the three components of the exposure area.',
    [46, 49, 50, 51],
  ),
  thresholdLayer(
    'slr-waves',
    'Annual High Wave Flooding',
    'Reach of the highest waves in a typical year, on top of the raised sea. This is what puts water well inland of the passive flooding line on exposed coasts.',
    [52, 53, 54, 55],
  ),
  thresholdLayer(
    'slr-erosion',
    'Coastal Erosion',
    'Land projected to be lost to shoreline retreat, not merely flooded. This ground does not come back at low tide.',
    [60, 61, 62, 63],
  ),
  thresholdLayer(
    'slr-highways',
    'Flooded Highways',
    'State highway segments within the exposure area. Oahu’s coastal highways are single points of failure for whole communities -- losing a segment can cut off far more than it floods.',
    [68, 69, 70, 71],
    { render: 'line', lineWidth: 4, opacity: 1, color: '#F5C542', levels: stops(HIGHWAY_COLORS) },
  ),
];

export const oahuSeaLevel = { ...STORY, layers: LAYERS };
