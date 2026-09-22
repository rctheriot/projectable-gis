import { computeHomography, type Correspondence, type Homography } from './homography';

const STORAGE_KEY = 'projectable.calibration.v1';

export interface Calibration {
  /** Camera pixel -> normalised table coordinate. */
  homography: Homography;
  /** The points it was solved from, so a calibration can be reviewed or extended. */
  points: Correspondence[];
  /** Resolution the points were captured at; a different one invalidates them. */
  width: number;
  height: number;
  savedAt: string;
}

/**
 * Target positions for the calibration routine, in normalised table coordinates.
 *
 * Inset from the corners because a puck has to sit fully within the camera's view,
 * and spread widely because a homography solved from points clustered in the middle
 * extrapolates badly to the edges.
 */
export const CALIBRATION_TARGETS: { x: number; y: number }[] = [
  { x: 0.15, y: 0.2 },
  { x: 0.85, y: 0.2 },
  { x: 0.85, y: 0.8 },
  { x: 0.15, y: 0.8 },
  // A fifth point in the centre turns the solve into a least-squares fit, which
  // averages out the error in how precisely each puck was placed.
  { x: 0.5, y: 0.5 },
];

export function loadCalibration(): Calibration | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Calibration;
    if (!Array.isArray(parsed.homography) || parsed.homography.length !== 9) return null;
    return parsed;
  } catch {
    // Private browsing, cleared storage, or a stale format: recalibrate.
    return null;
  }
}

export function saveCalibration(points: Correspondence[], width: number, height: number): Calibration | null {
  const homography = computeHomography(points);
  if (!homography) return null;

  const calibration: Calibration = {
    homography,
    points,
    width,
    height,
    savedAt: new Date().toISOString(),
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(calibration));
  } catch {
    // Storage being unavailable should not stop this session from working.
  }
  return calibration;
}

export function clearCalibration(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do.
  }
}
