/**
 * Declarative definition of the "Oahu Energy Goals" story.
 *
 * This replaces the 521-line `oahu/plan.ts`, which embedded live d3 closures per
 * layer and hand-tuned vw/vh constants per UI element. Everything here is data:
 * the build script reads it, and the browser reads the JSON it produces.
 *
 * To add a new story, copy this file, point `source` at your assets, and run
 * `npm run prepare-story`. No application code changes.
 */
import path from 'node:path';
import { PROJECT_ROOT } from './paths.mjs';

/** Where this story's raw assets live, relative to the project root. */
const SOURCE_DIR = path.join(
  PROJECT_ROOT,
  '..',
  'old_projectable_pucks',
  'haven-table-map-angular',
  'src',
  'assets',
  'plans',
  'oahu',
);

/**
 * Technology colours for the charts and legend.
 *
 * The legacy palette put orange (DER), yellow (PV) and red (Fossil) side by side,
 * which collapses under deuteranopia -- DER and Bio sat at only dE 4.4, and
 * Fossil/DER at dE 12.1 even for full-colour vision. These are re-stepped to keep
 * each technology's hue identity while clearing the contrast, chroma, lightness and
 * CVD checks against the dark projector surface.
 *
 * `seriesOrder` is the fixed assignment order. Colour follows the technology, never
 * its rank, so filtering the chart never repaints the remaining series.
 */
const palette = {
  Bio: '#3FA97F',
  Wind: '#4A86E8',
  Fossil: '#D2495B',
  PV: '#B58B1B',
  Offshore: '#A97BE0',
  DER: '#CE7228',
};

const seriesOrder = ['Bio', 'Wind', 'Fossil', 'PV', 'Offshore', 'DER'];

/**
 * Geographic corners of the base raster, [TL, TR, BR, BL].
 *
 * These come straight from the legacy `map.bounds` (north-west and south-east
 * corners). The legacy renderer also declared `width: 3613, height: 2794`, which
 * was stale copy-paste shared across four different islands -- it stretched the
 * raster to a 1.293 aspect regardless of its real shape. Oahu's raster is within
 * 0.3% of its bounds' true Web Mercator aspect, so the correct georeferencing is
 * simply corners == bounds, and the stretch was a bug.
 */
const NW = [-158.281, 21.71];
const SE = [-157.647, 21.252];
const corners = [
  [NW[0], NW[1]],
  [SE[0], NW[1]],
  [SE[0], SE[1]],
  [NW[0], SE[1]],
];

const STORY = {
  id: 'oahu-energy',
  sourceDir: SOURCE_DIR,
  title: 'Oahu Energy Goals',
  subtitle: "Land, time and trade-offs on the way to 100% renewable by 2045",
  years: { min: 2016, max: 2045 },
  corners,
  palette,
  seriesOrder,

  scenarios: [
    { id: 'postapril', name: 'Post April', description: 'Utility plan as filed after the April revision.' },
    { id: 'e3', name: 'E3', description: 'Consultant projection from E3.' },
    { id: 'e3genmod', name: 'E3 Gen Mod', description: 'E3 projection with generation modelling applied.' },
  ],

  // Rooftop solar below the Ko'olau range: the trade-off this story is about.
  cover: 'assets/covers/oahu-energy.png',

  source: {
    baseMap: 'images/oahu-satellite5.png',
    joins: [
      { id: 'derGroupCap', source: 'data/DER_Group_Cap.csv', columns: { key: 'GroupId', year: 'Year', value: 'Value' } },
    ],
  },

  dataSources: [
    { id: 'capacity', source: 'data/capacity.csv', unit: 'MW' },
    { id: 'generation', source: 'data/generation.csv', unit: 'MWh' },
    { id: 'curtailment', source: 'data/curtailment.csv', unit: 'MWh' },
  ],

  // The capacity trend duplicated what the generation mix already shows, so this
  // story runs a single chart in the top half of the puck rail.
  charts: [
    { id: 'generation-mix', type: 'bar', title: 'Generation mix', source: 'generation', unit: 'MWh' },
  ],

  /**
   * Puck bindings.
   *
   * `markerId` indexes the ARUCO_MIP_36h12 dictionary (0-249). Print the markers
   * with `npm run markers`. The legacy ids (384, 6, 7, 11) were for the original
   * ARUCO dictionary; 384 does not exist in 36h12, which has far better false
   * positive rejection and is worth the reprint.
   *
   * `degreesPerStep` should match the printed detent ring on the physical puck, so
   * one felt click equals exactly one step.
   */
  pucks: [
    { markerId: 0, label: 'Year', action: { type: 'year', step: 1 }, degreesPerStep: 15, color: '#EDAD08' },
    { markerId: 1, label: 'Layer', action: { type: 'select-layer' }, degreesPerStep: 30, color: '#38A6A5' },
    { markerId: 2, label: 'Add / Remove', action: { type: 'toggle-layer' }, degreesPerStep: 45, color: '#E17C05' },
    { markerId: 3, label: 'Scenario', action: { type: 'scenario' }, degreesPerStep: 45, color: '#AC346A' },
  ],
};

/** Layers, drawn bottom-first. */
const SOURCE_LAYERS = [
  {
    id: 'agriculture',
    name: 'Agricultural Lands',
    description:
      "The Land Study Bureau's overall productivity rating, Class A (most productive) through Class E. This is the land that renewable buildout competes with.",
    source: 'layers/lsb2.json',
    icon: 'images/icons/agriculture-icon.png',
    keepProperties: ['type'],
    render: 'fill',
    color: '#0F8554',
    outlineColor: 'white',
    lineWidth: 0.25,
    fill: {
      type: 'categorical',
      property: 'type',
      categories: { A: '#7DE87D', B: '#2EDD2E', C: '#00D100', D: '#009300', E: '#005400' },
      fallback: '#0F8554',
    },
  },
  {
    id: 'parks',
    name: 'Park Lands',
    description: 'State and county parks, which are unavailable for energy development.',
    source: 'layers/parks.json',
    icon: 'images/icons/parks-icon.png',
    keepProperties: [],
    render: 'fill',
    color: '#994E95',
    outlineColor: 'white',
    lineWidth: 1,
    fill: { type: 'static' },
  },
  {
    id: 'government',
    name: 'Government Lands',
    description: 'Federal, State, County and DHHL land, including the large military holdings in central Oahu.',
    source: 'layers/government1.json',
    icon: 'images/icons/dod-icon.png',
    keepProperties: [],
    render: 'fill',
    color: '#CC503E',
    outlineColor: 'white',
    lineWidth: 1,
    fill: { type: 'static' },
  },
  {
    id: 'solar',
    name: 'Utility-Scale Solar',
    description:
      'NREL technical potential for utility-scale solar, filling best-irradiance-first as each year’s PV generation target grows.',
    source: 'layers/solar.json',
    icon: 'images/icons/solar-icon.png',
    keepProperties: ['cf_1', 'capacity'],
    render: 'fill',
    color: '#E8892E',
    lineWidth: 0.2,
    fill: {
      type: 'buildout',
      // Curtailed PV still had to be built, so it counts toward land used.
      budget: { terms: [{ source: 'generation', technologies: ['PV'] }, { source: 'curtailment', technologies: ['PV'] }] },
      sortBy: [{ property: 'cf_1', direction: 'desc' }],
      cost: { properties: ['cf_1', 'capacity'], constant: 8760 },
      // Only 0.2% of this land is built in 2016, so without a faint tint on the
      // rest the layer looks like it failed to switch on.
      unbuiltColor: 'rgba(232, 137, 46, 0.16)',
    },
  },
  {
    id: 'wind',
    name: 'Wind Energy',
    description: 'NREL wind technical potential, filling largest-site-first as installed wind capacity grows.',
    source: 'layers/wind.json',
    icon: 'images/icons/wind-icon.png',
    keepProperties: ['MWac', 'SPD_CLS'],
    render: 'fill',
    color: '#2A52BE',
    lineWidth: 0.2,
    fill: {
      type: 'buildout',
      // Budget is installed wind capacity in MW; -99 MW is the wind already
      // standing in 2016, which the "Existing Renewables" layer shows instead.
      //
      // The legacy layer spent `MWac * 0.2283 * 8760` (annual MWh) out of a budget
      // measured in MW -- a units mismatch that made the budget ~2000x too small,
      // so at most one parcel ever lit up. Each parcel costs its own MWac.
      budget: { terms: [{ source: 'capacity', technologies: ['Wind'] }], offset: -99 },
      // Largest sites first; speed class only breaks ties between equal-size sites.
      sortBy: [
        { property: 'MWac', direction: 'desc' },
        { property: 'SPD_CLS', order: ['8.5+', '7.5-8.5', '6.5-7.5'] },
      ],
      cost: { properties: ['MWac'] },
      // Wind's budget is exactly zero in 2016, so the resource is all that shows.
      unbuiltColor: 'rgba(42, 82, 190, 0.18)',
    },
  },
  {
    id: 'der',
    name: 'Rooftop Solar Saturation',
    description:
      'Distributed rooftop PV as a share of each neighbourhood group’s hosting capacity. Red areas are approaching saturation.',
    source: 'layers/DERdata.json',
    icon: 'images/icons/der.jpg',
    keepProperties: ['Building_F'],
    render: 'fill',
    color: '#E17C05',
    outlineColor: 'transparent',
    lineWidth: 0.1,
    fill: {
      type: 'joined-choropleth',
      join: 'derGroupCap',
      featureKey: 'Building_F',
      keyTransform: 'after-underscore',
      firstYear: 2018,
      stops: [
        { min: 0.75, color: '#F5F500' },
        { min: 0.675, color: '#F5DA00' },
        { min: 0.6, color: '#F5BE00' },
        { min: 0.525, color: '#F5A300' },
        { min: 0.45, color: '#F58800' },
        { min: 0.375, color: '#F56D00' },
        { min: 0.3, color: '#F55200' },
        { min: 0.15, color: '#F53600' },
        { min: 0.05, color: '#F51B00' },
        { min: 0, color: '#F50000' },
      ],
    },
  },
  {
    id: 'existing-re',
    name: 'Existing Renewables',
    description: 'Renewable generation already online today.',
    source: 'layers/existing_re.json',
    icon: 'images/icons/existing_re-icon.png',
    keepProperties: [],
    render: 'fill',
    color: '#38A6A5',
    outlineColor: 'white',
    lineWidth: 1,
    fill: { type: 'static' },
  },
  {
    id: 'transmission',
    name: 'Transmission Lines',
    description:
      'The high-voltage transmission system. New generation is only useful where it can reach a load centre, so this constrains where buildout can go.',
    source: 'layers/transmission.json',
    icon: 'images/icons/transmission-icon.png',
    keepProperties: ['Voltage_kV'],
    render: 'line',
    color: '#CCFF00',
    lineWidth: { property: 'Voltage_kV', multiplier: 0.04, minimum: 1 },
    fill: { type: 'static' },
    defaultActive: true,
  },
];

export const oahuEnergy = { ...STORY, layers: SOURCE_LAYERS };
