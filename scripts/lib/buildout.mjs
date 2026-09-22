/**
 * Progressive-buildout precomputation.
 *
 * Features are ranked best-first, then assigned an *exclusive* prefix sum of their
 * cost. At runtime a feature is "built" when `_cum < budget` -- a single paint
 * expression against a scalar, with no per-feature JavaScript on year change.
 *
 * The prefix sum must be exclusive to match the original semantics: the old loop
 * tested `if (total > 0)` *before* subtracting, so a feature lights when the budget
 * remaining *before* consuming it is still positive. An inclusive sum lights one
 * feature too few at every year.
 */

export const CUM_PROP = '_cum';
export const EXCLUDED_PROP = '_ex';

/** Thrown when a sort or cost property is missing, rather than coercing to NaN. */
export class BuildoutDataError extends Error {}

function numeric(props, key, context) {
  const raw = props[key];
  const value = typeof raw === 'number' ? raw : Number.parseFloat(raw);
  if (!Number.isFinite(value)) {
    throw new BuildoutDataError(
      `${context}: property "${key}" is ${JSON.stringify(raw)}, which is not a finite number. ` +
        `A missing sort or cost key would silently randomise the buildout order.`,
    );
  }
  return value;
}

/**
 * Builds a comparator from an ordered list of sort keys. The first key is the
 * primary sort; later keys break ties.
 */
export function makeComparator(sortBy, context = 'buildout') {
  const keys = sortBy.map((key) => {
    if (key.order) {
      const rank = new Map(key.order.map((value, index) => [value, index]));
      return (props) => {
        const position = rank.get(String(props[key.property]));
        if (position === undefined) {
          throw new BuildoutDataError(
            `${context}: property "${key.property}" has value ` +
              `${JSON.stringify(props[key.property])}, which is not in the declared order ` +
              `[${key.order.join(', ')}].`,
          );
        }
        return position;
      };
    }
    const sign = key.direction === 'desc' ? -1 : 1;
    return (props) => sign * numeric(props, key.property, context);
  });

  return (a, b) => {
    for (const valueOf of keys) {
      const delta = valueOf(a.properties) - valueOf(b.properties);
      if (delta !== 0) return delta;
    }
    return 0;
  };
}

/** Cost of a single feature: the product of the named properties and the constant. */
export function featureCost(properties, cost, context = 'buildout') {
  let total = cost.constant ?? 1;
  for (const key of cost.properties) total *= numeric(properties, key, context);
  return total;
}

/**
 * Sorts `features` best-first and writes `_cum` (exclusive prefix sum of cost) and,
 * where relevant, `_ex` (1 for features held out of the buildout).
 *
 * Mutates and returns the array. Returns stats for the build log.
 */
export function annotateBuildout(features, spec, context = 'buildout') {
  const comparator = makeComparator(spec.sortBy, context);
  const isExcluded = spec.exclude
    ? (props) => props[spec.exclude.property] === spec.exclude.equals
    : () => false;

  features.sort(comparator);

  let cumulative = 0;
  let excludedCount = 0;

  for (const feature of features) {
    const props = feature.properties;
    if (isExcluded(props)) {
      // Excluded features never consume budget and are always drawn.
      props[EXCLUDED_PROP] = 1;
      props[CUM_PROP] = -1;
      excludedCount += 1;
      continue;
    }
    props[CUM_PROP] = cumulative;
    cumulative += featureCost(props, spec.cost, context);
  }

  return { total: cumulative, count: features.length, excluded: excludedCount };
}
