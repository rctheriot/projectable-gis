/**
 * "Where the Rain Falls".
 *
 * The story the relief model tells better than any flat map: Oahu's two mountain
 * ranges make the island's weather. The trade winds hit the Ko'olau wall, are forced
 * up, cool, and drop their water on the windward crest -- over 260 inches a year
 * within sight of leeward ground that gets 25. Ten times the rainfall, twelve miles
 * apart, because of a ridge you can put your hand on.
 *
 * And then the second half: the ahupua'a, the traditional land divisions, run from
 * the ridge to the reef. Their boundaries follow the same ridgelines that make the
 * rain, so each one holds a full slice of the gradient -- wet uplands, streams, dry
 * coast. Turning the layers on over the printed terrain shows that the divisions
 * are not drawn on the land, they are drawn *by* it.
 *
 * All layers come from the Hawai'i Statewide GIS Program, fetched once at build time.
 */
import { PROJECT_ROOT } from './paths.mjs';

const CLIMATE = 'https://geodata.hawaii.gov/arcgis/rest/services/Climate/MapServer';
const CULTURAL = 'https://geodata.hawaii.gov/arcgis/rest/services/HistoricCultural/MapServer';
const FRESHWATER = 'https://geodata.hawaii.gov/arcgis/rest/services/FreshWater/MapServer';

const OAHU_BBOX = [-158.31, 21.23, -157.62, 21.73];
const SIMPLIFY = { toleranceMetres: 5, minAreaSqm: 500 };
const SIMPLIFY_LINES = { toleranceMetres: 5 };

/*
 * The island name is spelled inconsistently upstream -- some rows use a typographic
 * 'okina, some a straight apostrophe -- so matching the exact string is fragile.
 * No other island name ends in "ahu", so a suffix match is both simpler and safer.
 */
const OAHU_ONLY = "mokupuni LIKE '%ahu'";

/**
 * Rainfall is a magnitude, so it gets a sequential ramp: one hue, dim to bright.
 * Bright means wet, which on a dark projector surface is the way round that reads.
 */
const RAINFALL_STOPS = [
  { value: 25, color: '#31556E', label: '25 in' },
  { value: 50, color: '#2E7295', label: '50 in' },
  { value: 80, color: '#2B90BD', label: '80 in' },
  { value: 120, color: '#35AEDB', label: '120 in' },
  { value: 180, color: '#5FCDEE', label: '180 in' },
  { value: 240, color: '#9BE4F8', label: '240 in' },
];

/**
 * The six moku of Oahu. A categorical palette, validated against the dark surface:
 * these are identities, not amounts, so they get distinct hues rather than a ramp.
 */
const MOKU_COLORS = {
  "ʻEwa": '#3FA97F',
  Kona: '#4A86E8',
  "Koʻolauloa": '#D2495B',
  "Ko'olaupoko": '#B58B1B',
  Waialua: '#A97BE0',
  "Waiʻanae": '#CE7228',
};

const STORY = {
  id: 'oahu-water',
  title: 'Where the Rain Falls',
  subtitle: 'How two mountain ranges make Oahu’s water, and how the island was divided to match',

  sourceDir: PROJECT_ROOT,
  baseMapImage: 'stories/oahu-energy/base-map.webp',
  baseMapWidth: 4096,
  baseMapHeight: 3171,
  corners: [
    [-158.281, 21.71],
    [-157.647, 21.71],
    [-157.647, 21.252],
    [-158.281, 21.252],
  ],

  /*
   * The dial is rainfall, and it *narrows*: at zero every contour is drawn, and as
   * it climbs the dry lowlands drop away until only the wettest lines remain,
   * collapsed onto the Ko'olau crest. On the table that happens on the actual ridge.
   */
  years: { min: 0, max: 260 },
  dial: { label: 'Rainfall at least', unit: 'in/yr', decimals: 0 },

  scenarios: [
    {
      id: 'annual',
      name: 'Annual average',
      description: 'Mean annual rainfall from the Rainfall Atlas of Hawai‘i.',
    },
  ],

  palette: {},
  seriesOrder: [],
  dataSources: [],
  charts: [],

  pucks: [
    { markerId: 0, label: 'Rainfall', action: { type: 'year', step: 5 }, degreesPerStep: 10, color: '#35AEDB' },
    { markerId: 1, label: 'Layer', action: { type: 'select-layer' }, degreesPerStep: 30, color: '#38A6A5' },
    { markerId: 2, label: 'Add / Remove', action: { type: 'toggle-layer' }, degreesPerStep: 45, color: '#E8A33D' },
  ],
};

const LAYERS = [
  {
    id: 'moku',
    name: 'Moku (Districts)',
    description:
      'The six traditional districts of Oahu. Their boundaries follow the two mountain ranges, so each district faces its own weather.',
    render: 'fill',
    color: '#4A86E8',
    outlineColor: '#FFFFFF',
    outlineOpacity: 0.55,
    lineWidth: 1.5,
    opacity: 0.3,
    remote: {
      service: CULTURAL,
      variants: [{ layer: 3 }],
      where: OAHU_ONLY,
      bbox: OAHU_BBOX,
      outFields: 'moku',
      keepFrom: true,
      simplify: SIMPLIFY,
    },
    fill: { type: 'categorical', property: 'moku', categories: MOKU_COLORS, fallback: '#4A86E8' },
  },
  {
    id: 'ahupuaa',
    name: 'Ahupuaʻa',
    description:
      'Land divisions running ridge to reef. Each holds a full slice of the rainfall gradient — wet uplands, a stream, dry coast — so a community had everything it needed within one boundary. The lines follow the terrain because the terrain is what they were drawn from.',
    render: 'fill',
    color: '#E8D9A8',
    outlineColor: '#FFF3D0',
    outlineOpacity: 0.85,
    lineWidth: 1,
    opacity: 0.08,
    remote: {
      service: CULTURAL,
      variants: [{ layer: 1 }],
      where: OAHU_ONLY,
      bbox: OAHU_BBOX,
      outFields: 'ahupuaa,moku',
      keepFrom: true,
      simplify: SIMPLIFY,
    },
    fill: { type: 'static' },
  },
  {
    id: 'watersheds',
    name: 'Watersheds',
    description:
      'The modern hydrological delineation of the same island. Worth turning on alongside the ahupuaʻa: two different centuries reading the same ridgelines.',
    render: 'fill',
    color: '#3FA97F',
    outlineColor: '#8FE0BE',
    outlineOpacity: 0.8,
    lineWidth: 1,
    opacity: 0.12,
    remote: {
      service: FRESHWATER,
      variants: [{ layer: 8 }],
      where: '1=1',
      bbox: OAHU_BBOX,
      simplify: SIMPLIFY,
    },
    fill: { type: 'static' },
  },
  {
    id: 'streams',
    name: 'Streams',
    description:
      'Where the rain goes after it lands. The density of this network on the windward side, against its near-absence on the leeward, is the rainfall map drawn in water.',
    render: 'line',
    color: '#6FC6FF',
    lineWidth: 1.2,
    opacity: 0.9,
    remote: {
      service: FRESHWATER,
      variants: [{ layer: 1 }],
      where: '1=1',
      bbox: OAHU_BBOX,
      simplify: SIMPLIFY_LINES,
    },
    fill: { type: 'static' },
  },
  {
    id: 'rainfall',
    name: 'Annual Rainfall',
    description:
      'Isohyets — lines of equal rainfall — from 25 to over 260 inches a year. Raise the dial to drop the dry lowlands and watch what is left collapse onto the Koʻolau crest.',
    render: 'line',
    color: '#35AEDB',
    lineWidth: 2,
    opacity: 1,
    defaultActive: true,
    remote: {
      service: CLIMATE,
      variants: [{ layer: 13 }],
      where: '1=1',
      bbox: OAHU_BBOX,
      outFields: 'contour',
      keepFrom: true,
      simplify: SIMPLIFY_LINES,
    },
    fill: {
      type: 'threshold',
      property: 'contour',
      comparison: 'gte',
      levels: RAINFALL_STOPS,
    },
  },
];

export const oahuWater = { ...STORY, layers: LAYERS };
