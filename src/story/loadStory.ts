import { csvParse } from 'd3-dsv';
import type { BudgetSpec, Story, StorySummary } from './types';

/** data[scenarioId][technology] -> Map<year, value> */
export type SeriesIndex = Record<string, Record<string, Map<number, number>>>;

export interface LoadedStory {
  story: Story;
  /** Indexed by DataSource id. */
  data: Record<string, SeriesIndex>;
  /** Technologies present in each source, in stable order. */
  technologies: Record<string, string[]>;
}

const DEFAULT_COLUMNS = { year: 'year', technology: 'technology', value: 'value', scenario: 'scenario' };

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status} ${response.statusText})`);
  return (await response.json()) as T;
}

export async function loadStoryIndex(): Promise<StorySummary[]> {
  return fetchJson<StorySummary[]>('stories/index.json');
}

function indexSeries(csv: string, columns: typeof DEFAULT_COLUMNS): { index: SeriesIndex; technologies: string[] } {
  const index: SeriesIndex = {};
  const technologies = new Set<string>();

  for (const row of csvParse(csv)) {
    const scenario = row[columns.scenario];
    const technology = row[columns.technology];
    const year = Number(row[columns.year]);
    const value = Number(row[columns.value]);
    if (!scenario || !technology || !Number.isFinite(year) || !Number.isFinite(value)) continue;

    technologies.add(technology);
    const byTechnology = (index[scenario] ??= {});
    (byTechnology[technology] ??= new Map()).set(year, value);
  }

  return { index, technologies: [...technologies].sort() };
}

/**
 * Loads a story and *all* of its data before returning.
 *
 * The legacy app let each chart component kick off its own CSV load, and the solar
 * layer then read generation data that only existed if the pie chart happened to
 * have resolved first. Everything is awaited here so the first paint is correct.
 */
export async function loadStory(path: string): Promise<LoadedStory> {
  const story = await fetchJson<Story>(path);

  const entries = await Promise.all(
    story.dataSources.map(async (source) => {
      const response = await fetch(source.path);
      if (!response.ok) throw new Error(`Could not load data series "${source.id}" (${response.status})`);
      const columns = { ...DEFAULT_COLUMNS, ...source.columns };
      return [source.id, indexSeries(await response.text(), columns)] as const;
    }),
  );

  const data: Record<string, SeriesIndex> = {};
  const technologies: Record<string, string[]> = {};
  for (const [id, parsed] of entries) {
    data[id] = parsed.index;
    technologies[id] = parsed.technologies;
  }

  assertSeriesOrderIsComplete(story, technologies);

  return { story, data, technologies };
}

/**
 * Fails loudly when a CSV contains a technology the story does not list in
 * `seriesOrder`.
 *
 * Charts assign colour and compute their totals from `seriesOrder`, so an unlisted
 * technology would silently vanish from both the slices and the headline number --
 * a wrong total with nothing on screen to indicate it. Better to refuse to open the
 * story than to show a confident wrong figure on a table in a public meeting.
 */
function assertSeriesOrderIsComplete(story: Story, technologies: Record<string, string[]>): void {
  const listed = new Set(story.seriesOrder);
  const missing = new Set<string>();
  for (const found of Object.values(technologies)) {
    for (const technology of found) if (!listed.has(technology)) missing.add(technology);
  }

  if (missing.size > 0) {
    throw new Error(
      `Story "${story.id}" has data for [${[...missing].sort().join(', ')}] but does not list ` +
        `${missing.size === 1 ? 'it' : 'them'} in seriesOrder [${story.seriesOrder.join(', ')}]. ` +
        `Unlisted technologies would be dropped from chart totals without warning.`,
    );
  }
}

/** Sums one technology's value for a given scenario and year. */
export function valueAt(data: SeriesIndex, technology: string, scenario: string, year: number): number {
  return data[scenario]?.[technology]?.get(year) ?? 0;
}

/** Sums several technologies for a given scenario and year. */
export function totalAt(data: SeriesIndex, technologies: string[], scenario: string, year: number): number {
  let total = 0;
  for (const technology of technologies) total += valueAt(data, technology, scenario, year);
  return total;
}

/**
 * Resolves a layer's buildout budget: how much capacity or generation is available
 * to spend on land in this scenario and year.
 */
export function resolveBudget(
  spec: BudgetSpec,
  sources: Record<string, SeriesIndex>,
  scenario: string,
  year: number,
): number {
  let total = spec.offset ?? 0;
  for (const term of spec.terms) {
    const source = sources[term.source];
    if (!source) continue;
    total += totalAt(source, term.technologies, scenario, year);
  }
  return total;
}
