import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain-JS module shared with the build script
import { annotateBuildout, featureCost, makeComparator, BuildoutDataError } from '../../../scripts/lib/buildout.mjs';

const feature = (properties: Record<string, unknown>) => ({ type: 'Feature', properties });

describe('makeComparator', () => {
  it('sorts numerically descending', () => {
    const rows = [feature({ v: 1 }), feature({ v: 9 }), feature({ v: 5 })];
    rows.sort(makeComparator([{ property: 'v', direction: 'desc' }]));
    expect(rows.map((r) => r.properties.v)).toEqual([9, 5, 1]);
  });

  it('uses later keys only to break ties', () => {
    // Mirrors the wind layer: MWac descending is primary, speed class secondary.
    const rows = [
      feature({ MWac: 5, SPD_CLS: '6.5-7.5' }),
      feature({ MWac: 5, SPD_CLS: '8.5+' }),
      feature({ MWac: 9, SPD_CLS: '6.5-7.5' }),
    ];
    rows.sort(
      makeComparator([
        { property: 'MWac', direction: 'desc' },
        { property: 'SPD_CLS', order: ['8.5+', '7.5-8.5', '6.5-7.5'] },
      ]),
    );
    expect(rows.map((r) => [r.properties.MWac, r.properties.SPD_CLS])).toEqual([
      [9, '6.5-7.5'],
      [5, '8.5+'],
      [5, '6.5-7.5'],
    ]);
  });

  it('throws rather than coercing a missing key to NaN', () => {
    const rows = [feature({ v: 1 }), feature({})];
    expect(() => rows.sort(makeComparator([{ property: 'v', direction: 'desc' }]))).toThrow(BuildoutDataError);
  });

  it('throws on a category outside the declared order', () => {
    const rows = [feature({ c: 'a' }), feature({ c: 'zzz' })];
    expect(() => rows.sort(makeComparator([{ property: 'c', order: ['a', 'b'] }]))).toThrow(BuildoutDataError);
  });
});

describe('featureCost', () => {
  it('multiplies the named properties by the constant', () => {
    expect(featureCost({ cf: 0.25, cap: 2 }, { properties: ['cf', 'cap'], constant: 8760 })).toBeCloseTo(4380);
  });

  it('defaults the constant to 1', () => {
    expect(featureCost({ a: 3, b: 4 }, { properties: ['a', 'b'] })).toBe(12);
  });
});

describe('annotateBuildout', () => {
  const spec = {
    sortBy: [{ property: 'q', direction: 'desc' as const }],
    cost: { properties: ['c'] },
  };

  it('writes an exclusive prefix sum so the first feature always lights', () => {
    const rows = [
      feature({ q: 1, c: 10 }),
      feature({ q: 3, c: 10 }),
      feature({ q: 2, c: 10 }),
    ];
    const stats = annotateBuildout(rows, spec);

    // Sorted 3,2,1 -> exclusive sums 0,10,20.
    expect(rows.map((r) => r.properties._cum)).toEqual([0, 10, 20]);
    expect(stats.total).toBe(30);

    // The original loop tested the budget *before* subtracting, so a budget of 10
    // lights exactly one feature. An inclusive prefix sum would light none.
    const lit = (budget: number) => rows.filter((r) => (r.properties._cum as number) < budget).length;
    expect(lit(0)).toBe(0);
    expect(lit(1)).toBe(1);
    expect(lit(10)).toBe(1);
    expect(lit(11)).toBe(2);
    expect(lit(999)).toBe(3);
  });

  it('holds excluded features out of the budget entirely', () => {
    // Mirrors the IAL layer: protected parcels are always drawn and never consume budget.
    const rows = [
      feature({ q: 3, c: 10, IAL: 'Y' }),
      feature({ q: 2, c: 10, IAL: 'N' }),
      feature({ q: 1, c: 10, IAL: 'N' }),
    ];
    const stats = annotateBuildout(rows, { ...spec, exclude: { property: 'IAL', equals: 'Y' } });

    expect(stats.excluded).toBe(1);
    expect(stats.total).toBe(20);
    expect(rows.map((r) => r.properties._ex ?? 0)).toEqual([1, 0, 0]);
    // The excluded parcel did not shift the prefix sum of the others.
    expect(rows.map((r) => r.properties._cum)).toEqual([-1, 0, 10]);
  });
});
