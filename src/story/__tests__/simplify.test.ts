import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain-JS module shared with the build script
import { simplifyFeature, simplifyFeatures } from '../../../scripts/lib/simplify.mjs';

/** ~1e-5 degrees is about 1m near the equator; Oahu is near 21N. */
const polygon = (ring: number[][]) => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'Polygon', coordinates: [ring] },
});

describe('simplifyFeature', () => {
  it('removes points that sit on a straight edge', () => {
    // A square whose top edge is broken into many collinear points.
    const ring: number[][] = [[-158, 21]];
    for (let i = 1; i <= 20; i += 1) ring.push([-158 + i * 0.0005, 21]);
    ring.push([-157.99, 21.01], [-158, 21.01], [-158, 21]);

    const feature = polygon(ring);
    const stats = simplifyFeature(feature, { toleranceMetres: 5 });

    expect(stats.after).toBeLessThan(stats.before);
    // The four corners must survive.
    expect(stats.after).toBeGreaterThanOrEqual(4);
  });

  it('keeps a shape that is already coarser than the tolerance', () => {
    const ring = [
      [-158, 21],
      [-157.99, 21],
      [-157.99, 21.01],
      [-158, 21.01],
      [-158, 21],
    ];
    const stats = simplifyFeature(polygon(ring), { toleranceMetres: 5 });
    expect(stats.after).toBe(5);
  });

  it('always emits a closed ring', () => {
    const ring: number[][] = [[-158, 21]];
    for (let i = 1; i <= 30; i += 1) ring.push([-158 + i * 0.0002, 21 + (i % 2) * 1e-7]);
    ring.push([-157.99, 21.01], [-158, 21.01], [-158, 21]);

    const feature = polygon(ring);
    simplifyFeature(feature, { toleranceMetres: 5 });

    for (const poly of feature.geometry.coordinates) {
      for (const r of poly) {
        expect(r.length).toBeGreaterThanOrEqual(4);
        expect(r[0]).toEqual(r[r.length - 1]);
      }
    }
  });

  it('drops parts below the minimum area', () => {
    // These datasets are full of slivers; they cost bytes and show nothing.
    const big = [
      [-158, 21],
      [-157.99, 21],
      [-157.99, 21.01],
      [-158, 21.01],
      [-158, 21],
    ];
    const sliver = [
      [-158, 21],
      [-157.99999, 21],
      [-157.99999, 21.00001],
      [-158, 21.00001],
      [-158, 21],
    ];
    const feature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'MultiPolygon', coordinates: [[big], [sliver]] },
    };

    const stats = simplifyFeature(feature, { toleranceMetres: 1, minAreaSqm: 500 });
    expect(stats.partsBefore).toBe(2);
    expect(stats.partsAfter).toBe(1);
  });

  it('simplifies linework too', () => {
    const line: number[][] = [];
    for (let i = 0; i <= 40; i += 1) line.push([-158 + i * 0.0002, 21]);
    const feature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: line },
    };

    const stats = simplifyFeature(feature, { toleranceMetres: 5 });
    expect(stats.after).toBe(2); // a straight line needs only its endpoints
    expect(feature.geometry.type).toBe('MultiLineString');
  });

  it('drops features that collapse entirely', () => {
    const tiny = [
      [-158, 21],
      [-157.999999, 21],
      [-157.999999, 21.000001],
      [-158, 21],
    ];
    const { features } = simplifyFeatures([polygon(tiny)], { toleranceMetres: 50, minAreaSqm: 1000 });
    expect(features).toHaveLength(0);
  });
});
