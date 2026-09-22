/**
 * Planar homography between a camera image and the table surface.
 *
 * The legacy tracker interpolated linearly between six hand-placed points, per
 * camera, assuming the camera was perfectly square to the table and had no lens
 * distortion. Neither is true, which is why it needed live arrow-key offset
 * nudging and a hack to stop the two cameras fighting over a marker.
 *
 * A homography models the real thing -- perspective included -- and maps both
 * cameras into one shared table frame, so a marker has the same coordinates no
 * matter which camera sees it.
 */

/** Row-major 3x3. */
export type Homography = readonly number[];

export interface Correspondence {
  /** Pixel coordinates in the camera image. */
  camera: { x: number; y: number };
  /** Normalised table coordinates, [0,1] across the projected surface. */
  table: { x: number; y: number };
}

/** Solves `A x = b` by Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i] as number]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs((M[row] as number[])[col] as number) > Math.abs((M[pivot] as number[])[col] as number)) pivot = row;
    }
    const pivotRow = M[pivot] as number[];
    if (Math.abs(pivotRow[col] as number) < 1e-12) return null; // Degenerate: points are collinear.
    [M[col], M[pivot]] = [pivotRow, M[col] as number[]];

    const current = M[col] as number[];
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const target = M[row] as number[];
      const factor = (target[col] as number) / (current[col] as number);
      if (factor === 0) continue;
      for (let k = col; k <= n; k += 1) target[k] = (target[k] as number) - factor * (current[k] as number);
    }
  }

  return M.map((row, i) => (row[n] as number) / ((row as number[])[i] as number));
}

/**
 * Computes the homography mapping camera pixels to table coordinates.
 *
 * Needs at least four correspondences, no three of them collinear. With more than
 * four this solves the least-squares fit, so extra calibration points improve the
 * result instead of being discarded.
 */
export function computeHomography(points: Correspondence[]): Homography | null {
  if (points.length < 4) return null;

  // Each correspondence contributes two rows to A h = b, with h33 fixed at 1.
  const rows: number[][] = [];
  const rhs: number[] = [];

  for (const { camera, table } of points) {
    const { x, y } = camera;
    rows.push([x, y, 1, 0, 0, 0, -x * table.x, -y * table.x]);
    rhs.push(table.x);
    rows.push([0, 0, 0, x, y, 1, -x * table.y, -y * table.y]);
    rhs.push(table.y);
  }

  // Normal equations give the least-squares solution for the over-determined case.
  const ATA: number[][] = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
  const ATb: number[] = new Array<number>(8).fill(0);

  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r] as number[];
    const value = rhs[r] as number;
    for (let i = 0; i < 8; i += 1) {
      const ai = row[i] as number;
      (ATA[i] as number[])[i] = ((ATA[i] as number[])[i] as number) + ai * ai;
      for (let j = i + 1; j < 8; j += 1) {
        const product = ai * (row[j] as number);
        (ATA[i] as number[])[j] = ((ATA[i] as number[])[j] as number) + product;
        (ATA[j] as number[])[i] = ((ATA[j] as number[])[i] as number) + product;
      }
      ATb[i] = (ATb[i] as number) + ai * value;
    }
  }

  const h = solve(ATA, ATb);
  return h ? [...h, 1] : null;
}

/** Maps a camera pixel through the homography into table coordinates. */
export function applyHomography(h: Homography, x: number, y: number): { x: number; y: number } {
  const w = (h[6] as number) * x + (h[7] as number) * y + (h[8] as number);
  if (Math.abs(w) < 1e-12) return { x: 0, y: 0 };
  return {
    x: ((h[0] as number) * x + (h[1] as number) * y + (h[2] as number)) / w,
    y: ((h[3] as number) * x + (h[4] as number) * y + (h[5] as number)) / w,
  };
}
