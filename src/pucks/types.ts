/** One observation of a physical puck, already in table coordinates. */
export interface PuckReading {
  markerId: number;
  /** Normalised table position, [0,1] across the projected surface. */
  x: number;
  y: number;
  /** Absolute rotation in degrees. */
  angle: number;
  /** 0..1. Readings below the consumer's threshold are ignored. */
  confidence: number;
  /** performance.now() when the frame was captured. */
  t: number;
  /**
   * Where the marker was in the camera image, in pixels, plus the frame size.
   *
   * Present only for camera-based sources. Calibration needs the raw pixels to
   * solve a homography, and the diagnostics overlay uses them to show what the
   * camera is actually seeing.
   */
  camera?: { x: number; y: number; width: number; height: number };
}

/** A frame: every puck currently visible. Pucks not listed are considered lifted. */
export type PuckFrame = PuckReading[];

/**
 * A source of puck readings.
 *
 * Keeping this behind an interface is what lets the table run from the keyboard at
 * a desk, from the cameras in the room, or from an external tracker process, with
 * no change to the application.
 */
export interface PuckSource {
  readonly id: string;
  readonly label: string;
  start(onFrame: (frame: PuckFrame) => void): Promise<void> | void;
  stop(): void;
  /** Human-readable state for the diagnostics panel. */
  getStatus(): { connected: boolean; detail: string };
}
