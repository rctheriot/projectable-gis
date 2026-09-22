/**
 * Geometry simplification for build-time data preparation.
 *
 * State hazard layers are published at survey precision: the 3.2 ft sea level rise
 * exposure area for Oahu alone is 23MB and 851,000 points, most of them describing
 * detail far finer than a projector pixel or a browser can usefully draw. Serving
 * that to visitors would be wasteful and slow.
 *
 * Douglas-Peucker in local metres, plus a minimum-area filter that removes the
 * slivers these datasets are full of. Both run once, at build time.
 */

const EARTH_RADIUS_M = 6378137;
const DEG_TO_M = (Math.PI / 180) * EARTH_RADIUS_M;

/**
 * Projects lon/lat to local metres around a reference latitude.
 *
 * An equirectangular approximation is exact enough here: these datasets span a
 * single island, where the error over a few tens of kilometres is far below the
 * tolerances we simplify at.
 */
function projector(referenceLatitude) {
  const scaleX = Math.cos((referenceLatitude * Math.PI) / 180) * DEG_TO_M;
  return ([lon, lat]) => [lon * scaleX, lat * DEG_TO_M];
}

/** Perpendicular distance from `point` to the segment `start`-`end`, in metres. */
function perpendicularDistance(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];

  if (dx === 0 && dy === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);

  const t = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));
  return Math.hypot(point[0] - (start[0] + clamped * dx), point[1] - (start[1] + clamped * dy));
}

/** Douglas-Peucker, iterative so a long ring cannot blow the stack. */
function douglasPeucker(points, tolerance) {
  if (points.length <= 2) return points;

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop();
    let maxDistance = 0;
    let index = -1;

    for (let i = first + 1; i < last; i += 1) {
      const distance = perpendicularDistance(points[i], points[first], points[last]);
      if (distance > maxDistance) {
        maxDistance = distance;
        index = i;
      }
    }

    if (maxDistance > tolerance && index !== -1) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  return points.filter((_, i) => keep[i] === 1);
}

/** Shoelace area in square metres. */
function ringArea(projected) {
  let sum = 0;
  for (let i = 0, j = projected.length - 1; i < projected.length; j = i, i += 1) {
    sum += (projected[j][0] - projected[i][0]) * (projected[j][1] + projected[i][1]);
  }
  return Math.abs(sum / 2);
}

/**
 * Simplifies one closed ring. Returns null when it collapses.
 *
 * A ring needs four positions to be valid GeoJSON (three distinct plus the repeat),
 * so anything that simplifies below that is dropped rather than emitted broken.
 */
function simplifyRing(ring, tolerance, project) {
  const projected = ring.map(project);
  const simplified = douglasPeucker(projected, tolerance);
  if (simplified.length < 4) return null;

  // Map back by index: Douglas-Peucker only ever removes points.
  const kept = new Set(simplified.map((point) => `${point[0]},${point[1]}`));
  const result = ring.filter((_, i) => kept.has(`${projected[i][0]},${projected[i][1]}`));

  if (result.length < 4) return null;
  // Close the ring if simplification dropped the repeated last position.
  const first = result[0];
  const last = result[result.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) result.push([first[0], first[1]]);
  return result.length >= 4 ? result : null;
}

/**
 * Simplifies a polygon or multipolygon feature in place.
 *
 * @returns statistics, or null if the whole feature collapsed.
 */
export function simplifyFeature(feature, { toleranceMetres, minAreaSqm = 0 }) {
  const geometry = feature.geometry;
  if (!geometry) return null;

  const isMulti = geometry.type === 'MultiPolygon';
  const isLine = geometry.type === 'LineString' || geometry.type === 'MultiLineString';
  if (!isMulti && geometry.type !== 'Polygon' && !isLine) return null;

  // Reference latitude from the first coordinate we can find.
  let sample = geometry.coordinates;
  while (Array.isArray(sample) && Array.isArray(sample[0])) sample = sample[0];
  const project = projector(Array.isArray(sample) ? sample[1] : 21);

  let before = 0;
  let after = 0;

  if (isLine) {
    const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
    const simplified = [];
    for (const line of lines) {
      before += line.length;
      const projected = line.map(project);
      const kept = douglasPeucker(projected, toleranceMetres);
      if (kept.length < 2) continue;
      const set = new Set(kept.map((p) => `${p[0]},${p[1]}`));
      const result = line.filter((_, i) => set.has(`${projected[i][0]},${projected[i][1]}`));
      if (result.length >= 2) {
        simplified.push(result);
        after += result.length;
      }
    }
    if (simplified.length === 0) return null;
    geometry.type = 'MultiLineString';
    geometry.coordinates = simplified;
    return { before, after, partsBefore: lines.length, partsAfter: simplified.length };
  }

  const polygons = isMulti ? geometry.coordinates : [geometry.coordinates];
  const simplifiedPolygons = [];

  for (const polygon of polygons) {
    const outer = polygon[0];
    if (!outer) continue;
    before += polygon.reduce((sum, ring) => sum + ring.length, 0);

    const projectedOuter = outer.map(project);
    // Drop slivers before spending any effort simplifying them.
    if (minAreaSqm > 0 && ringArea(projectedOuter) < minAreaSqm) continue;

    const simplifiedOuter = simplifyRing(outer, toleranceMetres, project);
    if (!simplifiedOuter) continue;

    const rings = [simplifiedOuter];
    for (const hole of polygon.slice(1)) {
      const projectedHole = hole.map(project);
      if (minAreaSqm > 0 && ringArea(projectedHole) < minAreaSqm) continue;
      const simplifiedHole = simplifyRing(hole, toleranceMetres, project);
      if (simplifiedHole) rings.push(simplifiedHole);
    }

    after += rings.reduce((sum, ring) => sum + ring.length, 0);
    simplifiedPolygons.push(rings);
  }

  if (simplifiedPolygons.length === 0) return null;

  geometry.type = 'MultiPolygon';
  geometry.coordinates = simplifiedPolygons;
  return { before, after, partsBefore: polygons.length, partsAfter: simplifiedPolygons.length };
}

/** Simplifies every feature, dropping any that collapse entirely. */
export function simplifyFeatures(features, options) {
  const kept = [];
  let before = 0;
  let after = 0;
  let partsBefore = 0;
  let partsAfter = 0;

  for (const feature of features) {
    const stats = simplifyFeature(feature, options);
    if (!stats) continue;
    before += stats.before;
    after += stats.after;
    partsBefore += stats.partsBefore;
    partsAfter += stats.partsAfter;
    kept.push(feature);
  }

  return { features: kept, before, after, partsBefore, partsAfter };
}
