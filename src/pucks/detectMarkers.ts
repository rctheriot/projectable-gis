import { AR, type ArucoMarker } from 'js-aruco2';

export interface DetectedMarker {
  id: number;
  corners: { x: number; y: number }[];
  /** Bits that had to be corrected to read it; 0 is a perfect read. */
  errors: number;
}

/** Why candidate squares in a frame were not read as markers. */
export interface Rejections {
  /** Too many border cells read white: glare, blur, or a square that is not a marker. */
  border: number;
  /** Border fine, but the pattern was not within tolerance of any marker. */
  pattern: number;
  /** Among pattern rejections, the closest any came to a real marker, in wrong bits. */
  nearestMiss: number | null;
}

export interface Detection {
  markers: DetectedMarker[];
  /**
   * Square outlines found before decoding. Comparing this with the markers read
   * separates the two ways detection fails: no square found at all (thresholding
   * or contours) versus a square found but not read (cell size, blur, glare).
   */
  candidates: number;
  rejected: Rejections;
}

/**
 * Which printed markers to look for.
 *
 *   - `mip`: ARUCO_MIP_36h12, what `npm run markers` prints.
 *   - `legacy`: the original ARUCO dictionary the 2022 app used, on the old black
 *     plastic pucks.
 *
 * One family at a time: reading both would double the chances of noise decoding
 * as a puck, for markers that are not on the table.
 */
export type MarkerSet = 'mip' | 'legacy';

export interface DecodeOptions {
  markerSet: MarkerSet;
  /** Most wrong pattern bits still accepted. 5 is the most that is always unambiguous. */
  maxBitErrors: number;
}

/**
 * Most bit errors a legacy read may have, whatever the setting. The original
 * dictionary's codes are only 3 bits apart, so correcting more than one bit could
 * turn one puck into another. The old app accepted exact matches only.
 */
const LEGACY_MAX_BIT_ERRORS = 1;

/**
 * Border cells allowed to read white. js-aruco2 rejects a marker if even one of
 * its 28 border cells is more than half white, so a single glint of projector
 * light on the edge threw away an otherwise perfect read. The pattern still has
 * to match, so a few bad border cells cannot make a non-marker pass.
 */
const BORDER_TOLERANCE = 3;

type Corners = { x: number; y: number }[];
interface WarpedImage {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

/** js-aruco2 internals used here; public in practice, missing from its types. */
interface DetectorInternals {
  candidates: unknown[];
  dictionary: { codeList: string[]; markSize: number };
  rotate(bits: number[][]): number[][];
  rotate2(corners: Corners, rotation: number): Corners;
  getMarker(warped: WarpedImage, candidate: Corners): ArucoMarker | null;
  notTooNear(candidates: Corners[], minDistance: number): Corners[];
}

function centre(corners: Corners) {
  return {
    x: corners.reduce((sum, c) => sum + c.x, 0) / corners.length,
    y: corners.reduce((sum, c) => sum + c.y, 0) / corners.length,
  };
}

function hamming(a: string, b: string): number {
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) distance += 1;
  return distance;
}

/**
 * Whether a cell of the warped, thresholded marker is white.
 *
 * Samples the cell's centre, not its whole area: the corners of a detected square
 * are only accurate to a pixel or so, which puts each cell's edges on its
 * neighbours. The centre is what is reliably inside the cell.
 */
function isWhite(image: WarpedImage, column: number, row: number, cell: number): boolean {
  const inset = Math.max(1, Math.floor(cell / 4));
  const x0 = column * cell + inset;
  const y0 = row * cell + inset;
  const size = cell - inset * 2;
  let white = 0;
  for (let y = y0; y < y0 + size; y += 1) {
    for (let x = x0; x < x0 + size; x += 1) if (image.data[y * image.width + x] !== 0) white += 1;
  }
  return white * 2 > size * size;
}

type AR_Detector = InstanceType<typeof AR.Detector>;

/** Settings for the frame being decoded, and what was rejected in it. */
let maxBitErrors = 5;
let rejects: { at: { x: number; y: number }; reason: 'border' | 'pattern'; distance?: number }[] = [];

/**
 * A js-aruco2 detector for one dictionary, with its candidate filter and its
 * per-square decode replaced.
 */
function createDetector(dictionaryName: string): AR_Detector {
  const detector = new AR.Detector({ dictionaryName });
  const internals = detector as unknown as DetectorInternals;
  const { codeList, markSize } = internals.dictionary;

  /*
   * Keep every candidate square. js-aruco2 drops one of any two squares whose
   * corners are within 10px, and keeps the *larger* -- but a printed marker always
   * produces two nested squares: its black border, and the edge of the white paper
   * one cell further out. Once a cell is under ~7px they are within 10px, so the
   * real marker was discarded and the paper outline decoded instead (and rejected,
   * its "border" being white). Markers smaller than ~56px were never read at all,
   * and near that size only intermittently. Duplicates are removed after decoding.
   */
  internals.notTooNear = (candidates) => candidates;

  /*
   * Replaces js-aruco2's per-candidate decode (same inputs, same output), with a
   * tolerant border check, centre sampling, and a record of why each square failed.
   */
  internals.getMarker = (warped, candidate) => {
    const cell = Math.floor(warped.width / markSize);

    let badBorder = 0;
    for (let row = 0; row < markSize; row += 1) {
      const step = row === 0 || row === markSize - 1 ? 1 : markSize - 1;
      for (let column = 0; column < markSize; column += step) {
        if (isWhite(warped, column, row, cell)) badBorder += 1;
      }
    }
    if (badBorder > BORDER_TOLERANCE) {
      rejects.push({ at: centre(candidate), reason: 'border' });
      return null;
    }

    let bits: number[][] = [];
    for (let row = 1; row < markSize - 1; row += 1) {
      const line: number[] = [];
      for (let column = 1; column < markSize - 1; column += 1) line.push(isWhite(warped, column, row, cell) ? 1 : 0);
      bits.push(line);
    }

    // The marker may be seen at any of four rotations; keep the closest match.
    let best = { id: -1, distance: Infinity, rotation: 0 };
    for (let rotation = 0; rotation < 4; rotation += 1) {
      const flat = bits.flat().join('');
      for (let id = 0; id < codeList.length; id += 1) {
        const distance = hamming(flat, codeList[id]!);
        if (distance < best.distance) best = { id, distance, rotation };
      }
      if (best.distance === 0) break;
      bits = internals.rotate(bits);
    }

    if (best.distance > maxBitErrors) {
      rejects.push({ at: centre(candidate), reason: 'pattern', distance: best.distance });
      return null;
    }

    return {
      id: best.id,
      corners: internals.rotate2(candidate, 4 - best.rotation),
      hammingDistance: best.distance,
    };
  };

  return detector;
}

/** Built on first use, so the family not in use costs nothing. */
const detectors: Partial<Record<MarkerSet, AR_Detector>> = {};
const DICTIONARIES: Record<MarkerSet, string> = { mip: 'ARUCO_MIP_36h12', legacy: 'ARUCO' };

export function detectMarkers(
  image: { width: number; height: number; data: Uint8ClampedArray },
  decode: Partial<DecodeOptions> = {},
): Detection {
  const markerSet = decode.markerSet ?? 'mip';
  const requested = decode.maxBitErrors ?? 5;
  maxBitErrors = markerSet === 'legacy' ? Math.min(requested, LEGACY_MAX_BIT_ERRORS) : requested;
  rejects = [];

  const detector = (detectors[markerSet] ??= createDetector(DICTIONARIES[markerSet]));
  const decoded = detector.detectImage(image.width, image.height, image.data);

  // Nested squares of one marker can both decode; keep the cleanest read of each.
  const markers: DetectedMarker[] = [];
  const byErrors = [...decoded].sort((a, b) => a.hammingDistance - b.hammingDistance);
  for (const marker of byErrors) {
    const at = centre(marker.corners);
    const size = Math.hypot(marker.corners[0]!.x - marker.corners[2]!.x, marker.corners[0]!.y - marker.corners[2]!.y);
    const duplicate = markers.some((kept) => {
      const other = centre(kept.corners);
      return kept.id === marker.id && Math.hypot(other.x - at.x, other.y - at.y) < size / 2;
    });
    if (duplicate) continue;
    markers.push({
      id: marker.id,
      corners: marker.corners.map((corner) => ({ x: corner.x, y: corner.y })),
      errors: marker.hammingDistance,
    });
  }

  // A marker that was read also leaves rejected squares behind -- the paper edge
  // around it, most often. Those are not failures, so only count rejections that
  // are not sitting on a marker that was read.
  const readAreas = markers.map((marker) => ({
    at: centre(marker.corners),
    radius: Math.hypot(marker.corners[0]!.x - marker.corners[2]!.x, marker.corners[0]!.y - marker.corners[2]!.y),
  }));
  const failures = rejects.filter(
    (reject) => !readAreas.some((area) => Math.hypot(area.at.x - reject.at.x, area.at.y - reject.at.y) < area.radius),
  );
  const misses = failures.filter((f) => f.reason === 'pattern').map((f) => f.distance!);

  return {
    markers,
    candidates: (detector as unknown as DetectorInternals).candidates.length,
    rejected: {
      border: failures.filter((f) => f.reason === 'border').length,
      pattern: misses.length,
      nearestMiss: misses.length ? Math.min(...misses) : null,
    },
  };
}
