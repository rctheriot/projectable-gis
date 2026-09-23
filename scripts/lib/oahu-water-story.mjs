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

const CULTURAL = 'https://geodata.hawaii.gov/arcgis/rest/services/HistoricCultural/MapServer';
const FRESHWATER = 'https://geodata.hawaii.gov/arcgis/rest/services/FreshWater/MapServer';

const OAHU_BBOX = [-158.31, 21.23, -157.62, 21.73];

/**
 * The twelve months the dial scrubs.
 *
 * HCDP's "new" production rainfall maps lag real time by a month or two, so this
 * ends two months back. Months that turn out not to be published yet are dropped
 * during the build rather than failing it.
 */
function lastTwelveMonths(endOffsetMonths = 2) {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - endOffsetMonths, 1));
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - (11 - i), 1));
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    return {
      value: i + 1,
      date: `${d.getUTCFullYear()}-${month}`,
      label: `${names[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
    };
  });
}

const MONTHS = lastTwelveMonths();

/**
 * Rainfall ramp, dry to wet, across the full spectrum.
 *
 * Every adjacent step is separated by dE 14 or more, so the bands are individually
 * readable rather than a smear. Lightness rises from the blue end and peaks at
 * yellow before the red -- unavoidable for a blue-to-red ramp, since yellow is
 * intrinsically the lightest hue there is. Ordering is therefore carried by hue,
 * which everyone already reads as blue-cool-less and red-hot-more, and reinforced
 * by opacity: the dry end fades toward transparent so the terrain shows through
 * where little falls, and the wet end is both the most saturated and the most solid.
 */
const RAINFALL_RAMP = ['#1E3A66', '#2B6FB0', '#1FA3A3', '#5CB84F', '#D4C230', '#E8853A', '#E0403A'];

/**
 * Layer hues, validated as a categorical palette against the dark surface.
 *
 * The rainfall rasters use the ramp above, so the vector layers have to stay
 * distinguishable from each other without competing with it.
 */
const LAYER_HUES = {
  moku: '#8878F0',
  watersheds: '#3FA97F',
  ahupuaa: '#C2842F',
  streams: '#3A9FD8',
};

/** Millimetres at which the ramp saturates, chosen for a single wet month. */
const MONTHLY_MAX_MM = 900;
/** Twelve months of accumulation reaches far higher on the crest. */
const ANNUAL_MAX_MM = 7000;
const SIMPLIFY = { toleranceMetres: 5, minAreaSqm: 500 };
const SIMPLIFY_LINES = { toleranceMetres: 5 };

/*
 * The island name is spelled inconsistently upstream -- some rows use a typographic
 * 'okina, some a straight apostrophe -- so matching the exact string is fragile.
 * No other island name ends in "ahu", so a suffix match is both simpler and safer.
 */
const OAHU_ONLY = "mokupuni LIKE '%ahu'";

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
   * The dial is time: twelve months of actual rainfall, not a long-term average.
   * Turning it through the year shows the windward side soak in the winter wet
   * season while the leeward plain stays dry in every frame.
   */
  years: { min: 1, max: 12 },
  dial: { label: 'Month', labels: MONTHS.map((m) => m.label) },

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
    { markerId: 0, label: 'Month', action: { type: 'year', step: 1 }, degreesPerStep: 30, color: '#35AEDB' },
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
    color: LAYER_HUES.moku,
    outlineColor: '#C9C0FF',
    outlineOpacity: 0.7,
    lineWidth: 1.5,
    opacity: 0.28,
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
    id: 'watersheds',
    name: 'Watersheds',
    description:
      'The modern hydrological delineation of the same island. Worth turning on alongside the ahupuaʻa: two different centuries reading the same ridgelines.',
    render: 'fill',
    color: LAYER_HUES.watersheds,
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
    id: 'ahupuaa',
    name: 'Ahupuaʻa',
    description:
      'Land divisions running ridge to reef. Each holds a full slice of the rainfall gradient — wet uplands, a stream, dry coast — so a community had everything it needed within one boundary. The lines follow the terrain because the terrain is what they were drawn from.',
    render: 'fill',
    color: LAYER_HUES.ahupuaa,
    outlineColor: '#F0C77A',
    outlineOpacity: 0.9,
    lineWidth: 1,
    opacity: 0.1,
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
    id: 'streams',
    name: 'Streams',
    description:
      'Where the rain goes after it lands. The density of this network on the windward side, against its near-absence on the leeward, is the rainfall map drawn in water.',
    render: 'line',
    color: LAYER_HUES.streams,
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
    id: 'rainfall-total',
    name: 'Rainfall, 12-month total',
    description:
      'Everything that fell over the last twelve months, accumulated. A filled field rather than contour lines, so the windward-leeward divide reads as a gradient instead of a set of boundaries.',
    render: 'raster',
    color: RAINFALL_RAMP[3],
    opacity: 0.8,
    ramp: RAINFALL_RAMP,
    maxValue: ANNUAL_MAX_MM,
    aggregate: 'sum',
    frameValue: 1,
    series: MONTHS,
    fill: { type: 'static' },
  },
  {
    id: 'rainfall-monthly',
    name: 'Rainfall by month',
    description:
      'Each month on its own, at 250m. The Ko\u02BBolau crest is wet in every frame; the \u02BBEwa plain is dry in every frame. What changes between them is the season.',
    render: 'raster',
    color: RAINFALL_RAMP[4],
    opacity: 0.85,
    defaultActive: true,
    ramp: RAINFALL_RAMP,
    maxValue: MONTHLY_MAX_MM,
    series: MONTHS,
    fill: { type: 'static' },
  },
];

export const oahuWater = { ...STORY, layers: LAYERS };
