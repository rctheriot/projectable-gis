import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain-JS module shared with the build script
import { slopeDegrees, slopeStats } from '../../../scripts/lib/terrain.mjs';

const EARTH_RADIUS = 6378137;
const mercatorY = (lat: number) => EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

/** A tilted plane at latitude 21.5°N, rising `degrees` towards the east. */
function plane(degrees: number, size = 21, groundMetres = 16) {
  const latitude = 21.5;
  const scale = Math.cos((latitude * Math.PI) / 180);
  const pixel = groundMetres / scale; // projected metres per pixel
  const rise = Math.tan((degrees * Math.PI) / 180) * groundMetres;
  const values = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) values[y * size + x] = 100 + x * rise;
  return {
    values,
    width: size,
    height: size,
    pixelX: pixel,
    pixelY: pixel,
    northY: mercatorY(latitude) + (size / 2) * pixel,
  };
}

describe('slopeDegrees', () => {
  it.each([5, 11.3, 20, 35])('recovers a %f° plane in ground terms, not Mercator', (degrees) => {
    const grid = plane(degrees);
    const slope = slopeDegrees(grid);
    // The centre pixel; latitude varies across the grid by a few metres only.
    expect(slope[10 * grid.width + 10]).toBeCloseTo(degrees, 1);
  });

  it('treats sea as no data', () => {
    const grid = plane(10);
    grid.values.fill(0);
    const slope = slopeDegrees(grid);
    expect(Number.isNaN(slope[10 * grid.width + 10])).toBe(true);
  });

  it('counts the share of land steeper than a threshold', () => {
    const grid = plane(25);
    const stats = slopeStats(slopeDegrees(grid), grid, 20);
    expect(stats.steepShare).toBe(1);
    expect(slopeStats(slopeDegrees(grid), grid, 30).steepShare).toBe(0);
  });
});
