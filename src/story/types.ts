/**
 * Story schema.
 *
 * A "story" is a self-contained, declarative GIS narrative: a georeferenced base
 * image, a set of vector layers, optional time-series data, and the puck bindings
 * that let people drive it from the table.
 *
 * Everything here is immutable data loaded from JSON. Nothing in a story is ever
 * mutated at runtime -- all mutable state (which year, which scenario, which layers
 * are on) lives in the Zustand store. The old Angular app mutated `layer.active`
 * directly on the exported plan object, which left stale toggles behind whenever
 * you navigated away and back.
 */

/** [longitude, latitude] */
export type LngLat = [number, number];

/** Image corners in [top-left, top-right, bottom-right, bottom-left] order. */
export type ImageCorners = [LngLat, LngLat, LngLat, LngLat];

export interface StorySummary {
  id: string;
  title: string;
  subtitle?: string;
  coverImage?: string;
  /** Path to the story.json, relative to the site root. */
  path: string;
}

export interface BaseMap {
  /** Path to the georeferenced raster, relative to the site root. */
  image: string;
  /** True geographic corners of the raster. */
  corners: ImageCorners;
  width: number;
  height: number;
}

export interface Scenario {
  id: string;
  name: string;
  description?: string;
}

/** A CSV series indexed as data[scenario][technology] -> {year, value}[] */
export interface DataSource {
  id: string;
  path: string;
  /** Column names in the CSV. Defaults cover the common `year,technology,value,scenario` shape. */
  columns?: { year?: string; technology?: string; value?: string; scenario?: string };
  /** Human-facing unit, e.g. "MW" or "MWh". */
  unit?: string;
}

/** A keyed lookup table joined onto features, indexed as data[key][year] -> value. */
export interface JoinSource {
  id: string;
  path: string;
  columns: { key: string; year: string; value: string };
}

// ---------------------------------------------------------------------------
// Fill modes -- how a layer decides what colour each feature is
// ---------------------------------------------------------------------------

/** Every feature gets the same colour. */
export interface StaticFill {
  type: 'static';
}

/** Colour looked up from a feature property, e.g. agricultural productivity class. */
export interface CategoricalFill {
  type: 'categorical';
  property: string;
  categories: Record<string, string>;
  fallback?: string;
}

/**
 * Progressive buildout. Features are ranked best-first, then "filled" in order
 * until the year's energy budget runs out -- so scrubbing the year puck makes the
 * buildout spread across the island.
 *
 * Ranking and the cumulative cost prefix-sum are precomputed at build time into a
 * `_cum` property on each feature, so at runtime this is a single paint expression
 * against a scalar budget. No per-feature work happens when the year changes.
 */
export interface BuildoutFill {
  type: 'buildout';
  /** How much energy/capacity is available to spend this year. */
  budget: BudgetSpec;
  /** Sort keys, applied in order. First key is the primary sort. */
  sortBy: SortKey[];
  /** What each feature costs: the product of these properties and constant. */
  cost: { properties: string[]; constant?: number };
  /**
   * Features matching this predicate are held out of the buildout entirely: they
   * never consume budget and are always drawn in `excludedColor`. On Oahu this is
   * how solar builds out *around* protected Important Agricultural Land.
   */
  exclude?: { property: string; equals: string | number | boolean };
  /** Colour for excluded features. */
  excludedColor?: string;
  /**
   * Colour for land that is in the resource but not yet built at this year.
   *
   * Without this a buildout layer is invisible until its budget grows, so turning
   * it on in an early year looks broken. Showing the unbuilt resource faintly makes
   * the mechanic legible: here is the land available, here is how much is used.
   */
  unbuiltColor?: string;
}

export interface BudgetSpec {
  /** Terms are summed. */
  terms: BudgetTerm[];
  /** Added to the summed terms (the old wind layer used -99 for existing capacity). */
  offset?: number;
}

export interface BudgetTerm {
  /** Id of a DataSource. */
  source: string;
  technologies: string[];
}

export interface SortKey {
  property: string;
  /** Numeric sort direction. Ignored when `order` is given. */
  direction?: 'asc' | 'desc';
  /** Explicit ordering for categorical keys, best-first. */
  order?: string[];
}

/**
 * Choropleth joined to a per-year table, e.g. rooftop-solar saturation per
 * building group. Values are precomputed into `y<YEAR>` properties at build time.
 */
export interface JoinedChoroplethFill {
  type: 'joined-choropleth';
  /** Id of a JoinSource. */
  join: string;
  /** Feature property holding the join key. */
  featureKey: string;
  /** Applied to the feature property to derive the join key. */
  keyTransform?: 'after-underscore';
  /** Colour ramp, highest threshold first. */
  stops: { min: number; color: string }[];
  /** Years before this have no data and render nothing. */
  firstYear?: number;
}

/**
 * Features appear once the dial reaches the level recorded on them.
 *
 * Used for nested hazard footprints -- each sea level rise scenario is a separate
 * published dataset, tagged with its level and stacked largest-first, so turning the
 * dial reveals bands and you can see which ground goes under soonest.
 */
export interface ThresholdFill {
  type: 'threshold';
  /** Feature property holding the level at which the feature turns on. */
  property: string;
  /** The dial is an integer; multiply by this to get the compared value. */
  dialScale?: number;
  /**
   * Which way the dial filters.
   *
   * `lte` (the default) reveals: sea level rise footprints appear as the water
   * climbs past them. `gte` narrows: rainfall contours drop away as the dial rises,
   * until only the wettest remain on the ridge crest.
   */
  comparison?: 'lte' | 'gte';
  /** Colour per level, lowest first. A sequential ramp, since this is magnitude. */
  levels: { value: number; color: string; label?: string }[];
}

export type FillMode =
  | StaticFill
  | CategoricalFill
  | BuildoutFill
  | JoinedChoroplethFill
  | ThresholdFill;

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

/** One frame of a raster series: the image shown when the dial reaches `value`. */
export interface RasterFrame {
  value: number;
  image: string;
  label?: string;
}

export interface StoryLayer {
  id: string;
  name: string;
  /** Path to the GeoJSON, relative to the site root. Absent for raster layers. */
  data?: string;
  icon?: string;
  description?: string;
  /**
   * Rendering primitive.
   *
   * `line` is for linework; `raster` is a georeferenced image, or a series of them
   * indexed by the dial -- a continuous field such as a rainfall grid, which vector
   * contours can only approximate.
   */
  render: 'fill' | 'line' | 'raster';
  fill: FillMode;
  /** Raster layers only: the frames, and where to put them. */
  frames?: RasterFrame[];
  corners?: ImageCorners;
  color: string;
  outlineColor?: string;
  /** For `line` layers this is the stroke width; supports a property multiplier. */
  lineWidth?: number | { property: string; multiplier: number; minimum?: number };
  opacity?: number;
  /**
   * Opacity of the outline, independent of the fill.
   *
   * A zone boundary often needs to be far more solid than the area it encloses --
   * "am I inside it" is the question -- while a layer of thousands of small parcels
   * wants a faint edge that does not turn into noise.
   */
  outlineOpacity?: number;
  /** Shown as on when the story opens. */
  defaultActive?: boolean;
  /**
   * Total cost of every feature in a buildout layer, written by the build script.
   * Lets the legend report how much of the resource is built at the current year.
   */
  buildoutTotal?: number;
}

// ---------------------------------------------------------------------------
// Pucks
// ---------------------------------------------------------------------------

export type PuckAction =
  | { type: 'year'; step?: number }
  | { type: 'scenario' }
  | { type: 'select-layer' }
  | { type: 'toggle-layer' };

export interface PuckBinding {
  /** Fiducial marker id on the underside of the physical puck. */
  markerId: number;
  /** Second marker, for redundancy and a better angle estimate. */
  secondaryMarkerId?: number;
  label: string;
  action: PuckAction;
  /** Degrees of rotation per discrete step. Match this to the puck's printed detents. */
  degreesPerStep: number;
  color: string;
}

// ---------------------------------------------------------------------------
// Charts and story root
// ---------------------------------------------------------------------------

export interface ChartSpec {
  id: string;
  type: 'bar' | 'line';
  title: string;
  /** Id of a DataSource. */
  source: string;
  unit?: string;
}

/**
 * How the main dial reads.
 *
 * The store always holds an integer, because a puck emits discrete steps. This says
 * how to turn that integer into something meaningful: a year reads as-is, while a
 * sea level in tenths of a foot reads as `1.1 ft`.
 */
export interface DialSpec {
  label: string;
  /** Multiplies the stored integer for display and for threshold comparisons. */
  scale?: number;
  decimals?: number;
  unit?: string;
  /**
   * Names for each dial position, indexed from `years.min`. Months read as
   * "January", not "1".
   */
  labels?: string[];
}

export interface Story {
  id: string;
  title: string;
  subtitle?: string;
  /** Inclusive range the dial scrubs. Equal values disable it. */
  years: { min: number; max: number };
  /** Defaults to a plain year readout. */
  dial?: DialSpec;
  scenarios: Scenario[];
  baseMap: BaseMap;
  layers: StoryLayer[];
  dataSources: DataSource[];
  joinSources?: JoinSource[];
  charts: ChartSpec[];
  pucks: PuckBinding[];
  /** Technology -> colour, shared by charts and legends. */
  palette: Record<string, string>;
  /**
   * Fixed colour-assignment order. Colour follows the technology, never its rank,
   * so filtering a chart never repaints the series that remain.
   */
  seriesOrder: string[];
}
