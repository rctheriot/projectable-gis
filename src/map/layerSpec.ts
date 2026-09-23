import type { ExpressionSpecification, DataDrivenPropertyValueSpecification } from 'maplibre-gl';
import type { StoryLayer } from '@/story/types';

/** Written by the build script: exclusive prefix sum of buildout cost. */
export const CUM_PROP = '_cum';
/** Written by the build script: 1 for features held out of the buildout. */
export const EXCLUDED_PROP = '_ex';

const TRANSPARENT = 'rgba(0,0,0,0)';

export const fillLayerId = (layer: StoryLayer) => `${layer.id}__fill`;

/**
 * The paint property that carries a layer's colour.
 *
 * A `line` layer has no `fill-color`, and MapLibre throws when you set a paint
 * property a layer type does not have. Both the initial paint and every later
 * update go through this, so the two can never disagree.
 */
export const colorProperty = (layer: StoryLayer): 'fill-color' | 'line-color' =>
  layer.render === 'line' ? 'line-color' : 'fill-color';
export const outlineLayerId = (layer: StoryLayer) => `${layer.id}__outline`;
export const sourceId = (layer: StoryLayer) => `${layer.id}__source`;

/**
 * Builds the fill-colour expression for a layer.
 *
 * `budget` and `year` are the only runtime inputs, and both collapse to scalars
 * inside the expression. Changing the year therefore costs one
 * `setPaintProperty` call, not a pass over 10,000 features.
 */
export function fillColorExpression(
  layer: StoryLayer,
  budget: number,
  year: number,
): DataDrivenPropertyValueSpecification<string> {
  const fill = layer.fill;

  switch (fill.type) {
    case 'static':
      return layer.color;

    case 'categorical': {
      const match: unknown[] = ['match', ['to-string', ['get', fill.property]]];
      for (const [value, color] of Object.entries(fill.categories)) match.push(value, color);
      match.push(fill.fallback ?? layer.color);
      return match as unknown as ExpressionSpecification;
    }

    case 'buildout': {
      // Built when the budget remaining *before* paying for this feature is still
      // positive -- hence `<` against an exclusive prefix sum.
      const unbuilt = fill.unbuiltColor ?? TRANSPARENT;
      const built: unknown[] = ['case', ['<', ['get', CUM_PROP], budget], layer.color, unbuilt];
      if (!fill.exclude) return built as unknown as ExpressionSpecification;
      return [
        'case',
        ['==', ['get', EXCLUDED_PROP], 1],
        fill.excludedColor ?? layer.color,
        ...built.slice(1),
      ] as unknown as ExpressionSpecification;
    }

    case 'threshold': {
      const level = year * (fill.dialScale ?? 1);
      const ascending = [...fill.levels].sort((a, b) => a.value - b.value);
      const first = ascending[0];
      if (!first) return TRANSPARENT;

      /*
       * `step`, not `match`: MapLibre requires match labels to be integers, and
       * these levels are 0.5, 1.1, 2.0 and 3.2 feet. An invalid expression makes the
       * whole layer silently fail to paint.
       */
      const ramp: unknown[] = ['step', ['to-number', ['get', fill.property], 0], first.color];
      for (const stop of ascending.slice(1)) ramp.push(stop.value, stop.color);

      // Rounded because the dial holds integer tenths and the data holds decimals.
      return [
        'case',
        thresholdTest(fill, level),
        ramp,
        TRANSPARENT,
      ] as unknown as ExpressionSpecification;
    }

    case 'joined-choropleth': {
      const key = `y${year}`;
      if (fill.firstYear !== undefined && year < fill.firstYear) return TRANSPARENT;

      const ascending = [...fill.stops].sort((a, b) => a.min - b.min);
      const first = ascending[0];
      if (!first) return layer.color;

      const step: unknown[] = ['step', ['to-number', ['get', key]], first.color];
      for (const stop of ascending.slice(1)) step.push(stop.min, stop.color);

      // Features with no value for this year render nothing at all.
      return ['case', ['has', key], step, TRANSPARENT] as unknown as ExpressionSpecification;
    }
  }
}

/**
 * Whether a feature is past the dial.
 *
 * The fallback pushes a feature without the property to the side that hides it,
 * whichever direction the comparison runs.
 */
function thresholdTest(fill: { property: string; comparison?: 'lte' | 'gte' }, level: number): unknown {
  const rounded = Math.round(level * 1e6) / 1e6;
  return fill.comparison === 'gte'
    ? ['>=', ['to-number', ['get', fill.property], -1e9], rounded]
    : ['<=', ['to-number', ['get', fill.property], 1e9], rounded];
}

/**
 * Outline colour for a fill layer.
 *
 * The outline has to follow the same rule as the fill: an unbuilt parcel with a
 * visible border still reads as a mark on the map. Drawing outlines unconditionally
 * covered the unbuilt half of the island in white speckle.
 */
export function outlineColorExpression(
  layer: StoryLayer,
  budget: number,
  year: number,
): DataDrivenPropertyValueSpecification<string> {
  const outline = layer.outlineColor ?? TRANSPARENT;
  const fill = layer.fill;

  switch (fill.type) {
    case 'static':
    case 'categorical':
      return outline;

    case 'buildout': {
      const built: unknown[] = ['case', ['<', ['get', CUM_PROP], budget], outline, TRANSPARENT];
      void fill;
      if (!fill.exclude) return built as unknown as ExpressionSpecification;
      return [
        'case',
        ['==', ['get', EXCLUDED_PROP], 1],
        outline,
        ...built.slice(1),
      ] as unknown as ExpressionSpecification;
    }

    case 'threshold': {
      return ['case', thresholdTest(fill, year * (fill.dialScale ?? 1)), outline, TRANSPARENT] as unknown as ExpressionSpecification;
    }

    case 'joined-choropleth': {
      if (fill.firstYear !== undefined && year < fill.firstYear) return TRANSPARENT;
      return ['case', ['has', `y${year}`], outline, TRANSPARENT] as unknown as ExpressionSpecification;
    }
  }
}

/** Line width, optionally scaled by a feature property such as voltage. */
export function lineWidthExpression(
  layer: StoryLayer,
): DataDrivenPropertyValueSpecification<number> {
  const width = layer.lineWidth ?? 1;
  if (typeof width === 'number') return width;
  return [
    'max',
    width.minimum ?? 0,
    ['*', ['to-number', ['get', width.property], 0], width.multiplier],
  ] as unknown as ExpressionSpecification;
}
