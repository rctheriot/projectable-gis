import { createPropertyExpression, v8 } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { colorProperty, fillColorExpression, lineWidthExpression, outlineColorExpression } from '../layerSpec';
import type { StoryLayer } from '@/story/types';

/**
 * Compiles an expression the way MapLibre does when a style is loaded.
 *
 * An invalid paint expression does not throw at runtime -- the layer simply never
 * paints, with nothing in the console. That is exactly how a `match` with
 * non-integer labels (0.5, 1.1, 3.2 feet) silently blanked the sea level layer, so
 * every generated expression is compiled here.
 */
// The real style-spec definitions, so this compiles exactly as MapLibre would.
const spec = v8 as unknown as Record<string, Record<string, unknown>>;
const FILL_COLOR = spec['paint_fill']!['fill-color'];
const LINE_WIDTH = spec['paint_line']!['line-width'];

const compileColor = (value: unknown) =>
  createPropertyExpression(value, 'fill-color', FILL_COLOR as never);
const compileNumber = (value: unknown) =>
  createPropertyExpression(value, 'line-width', LINE_WIDTH as never);

const base: StoryLayer = {
  id: 'test',
  name: 'Test',
  data: 'test.geojson',
  render: 'fill',
  color: '#E8892E',
  fill: { type: 'static' },
};

/** Evaluates a compiled colour expression against one feature's properties. */
function evaluate(result: ReturnType<typeof compileColor>, properties: Record<string, unknown>) {
  if (result.result !== 'success') throw new Error(JSON.stringify(result.value));
  return result.value.evaluate({ zoom: 10 }, { type: 'Feature', properties, geometry: null } as never);
}

describe('fillColorExpression compiles for every fill mode', () => {
  it('static', () => {
    expect(compileColor(fillColorExpression(base, 0, 0)).result).toBe('success');
  });

  it('categorical', () => {
    const layer: StoryLayer = {
      ...base,
      fill: { type: 'categorical', property: 'type', categories: { A: '#fff', B: '#000' }, fallback: '#888' },
    };
    expect(compileColor(fillColorExpression(layer, 0, 0)).result).toBe('success');
  });

  it('buildout, with and without an exclusion', () => {
    const fill = {
      type: 'buildout' as const,
      budget: { terms: [{ source: 'generation', technologies: ['PV'] }] },
      sortBy: [{ property: 'cf_1', direction: 'desc' as const }],
      cost: { properties: ['cf_1'] },
    };
    expect(compileColor(fillColorExpression({ ...base, fill }, 10, 2020)).result).toBe('success');
    expect(
      compileColor(
        fillColorExpression(
          { ...base, fill: { ...fill, exclude: { property: 'IAL', equals: 'Y' }, excludedColor: '#000' } },
          10,
          2020,
        ),
      ).result,
    ).toBe('success');
  });

  it('joined-choropleth', () => {
    const layer: StoryLayer = {
      ...base,
      fill: {
        type: 'joined-choropleth',
        join: 'der',
        featureKey: 'Building_F',
        stops: [
          { min: 0, color: '#f00' },
          { min: 0.5, color: '#ff0' },
        ],
        firstYear: 2018,
      },
    };
    expect(compileColor(fillColorExpression(layer, 0, 2020)).result).toBe('success');
    expect(compileColor(fillColorExpression(layer, 0, 2016)).result).toBe('success');
  });

  it('threshold, whose levels are not integers', () => {
    // The regression: MapLibre's `match` requires integer labels, so 0.5/1.1/3.2
    // produced an expression that compiled nowhere and painted nothing.
    const layer: StoryLayer = {
      ...base,
      fill: {
        type: 'threshold',
        property: 'slr_ft',
        dialScale: 0.1,
        levels: [
          { value: 0.5, color: '#7FD4F5' },
          { value: 1.1, color: '#45A8E0' },
          { value: 2.0, color: '#2C7BC0' },
          { value: 3.2, color: '#1F4E96' },
        ],
      },
    };

    const compiled = compileColor(fillColorExpression(layer, 30, 30));
    expect(compiled.result).toBe('success');
    expect(compileColor(outlineColorExpression({ ...layer, outlineColor: '#fff' }, 30, 30)).result).toBe('success');
  });
});

describe('threshold fill reveals levels as the dial rises', () => {
  const layer: StoryLayer = {
    ...base,
    fill: {
      type: 'threshold',
      property: 'slr_ft',
      dialScale: 0.1,
      levels: [
        { value: 0.5, color: '#7fd4f5' },
        { value: 1.1, color: '#45a8e0' },
        { value: 2, color: '#2c7bc0' },
        { value: 3.2, color: '#1f4e96' },
      ],
    },
  };

  const alphaOf = (dial: number, slr: number) =>
    evaluate(compileColor(fillColorExpression(layer, dial, dial)), { slr_ft: slr }).a;

  it('hides every level at zero', () => {
    for (const level of [0.5, 1.1, 2, 3.2]) expect(alphaOf(0, level)).toBe(0);
  });

  it('shows a level once the dial reaches it, and not before', () => {
    expect(alphaOf(4, 0.5)).toBe(0); // 0.4 ft has not reached the 0.5 ft band
    expect(alphaOf(5, 0.5)).toBeGreaterThan(0);
    expect(alphaOf(4, 1.1)).toBe(0);
    expect(alphaOf(11, 1.1)).toBeGreaterThan(0);
    expect(alphaOf(30, 3.2)).toBe(0); // 3.0 ft has not reached 3.2
    expect(alphaOf(32, 3.2)).toBeGreaterThan(0);
  });

  it('gives each level its own colour, so bands are distinguishable', () => {
    const at = (slr: number) => evaluate(compileColor(fillColorExpression(layer, 32, 32)), { slr_ft: slr });
    const colors = [0.5, 1.1, 2, 3.2].map((v) => `${at(v).r},${at(v).g},${at(v).b}`);
    expect(new Set(colors).size).toBe(4);
  });
});

describe('colorProperty', () => {
  /*
   * A `line` layer has no `fill-color`, and MapLibre throws when a paint property
   * is set that the layer type does not have. The flooded-highways layer is both a
   * line layer *and* a threshold layer, so it is repainted whenever the dial moves
   * -- which crashed the app on every step until the property was chosen by render
   * type rather than assumed to be `fill-color`.
   */
  it('picks the property that the layer type actually has', () => {
    expect(colorProperty({ ...base, render: 'fill' })).toBe('fill-color');
    expect(colorProperty({ ...base, render: 'line' })).toBe('line-color');
  });

  it('compiles a threshold expression against the line-colour spec too', () => {
    const layer: StoryLayer = {
      ...base,
      render: 'line',
      lineWidth: 3,
      fill: {
        type: 'threshold',
        property: 'slr_ft',
        dialScale: 0.1,
        levels: [
          { value: 0.5, color: '#7FD4F5' },
          { value: 3.2, color: '#1F4E96' },
        ],
      },
    };
    const compiled = createPropertyExpression(
      fillColorExpression(layer, 32, 32),
      'line-color',
      spec['paint_line']!['line-color'] as never,
    );
    expect(compiled.result).toBe('success');
  });
});

describe('lineWidthExpression', () => {
  it('compiles a property-scaled width', () => {
    const layer: StoryLayer = {
      ...base,
      render: 'line',
      lineWidth: { property: 'Voltage_kV', multiplier: 0.04, minimum: 1 },
    };
    expect(compileNumber(lineWidthExpression(layer)).result).toBe('success');
  });
});
