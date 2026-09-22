/**
 * Turns a stream of absolute puck angles into discrete steps.
 *
 * The legacy version compared corner angles across a 40-frame history, gated on a
 * `minRotation` threshold, then disabled the puck for a fixed `delay` so one twist
 * would not fire repeatedly. That stack of fudge factors meant fast turns dropped
 * steps and slow turns fired twice.
 *
 * Here the angle is integrated instead. Every degree the puck turns is banked, and
 * a step is emitted for each whole `degreesPerStep` of accumulated rotation, so a
 * fast half-turn emits the same number of steps as a slow one. Set
 * `degreesPerStep` to match the puck's printed detent ring and one felt click
 * equals exactly one step.
 */
export class RotationAccumulator {
  private previousAngle: number | null = null;
  private banked = 0;

  constructor(private readonly degreesPerStep: number) {
    if (!(degreesPerStep > 0)) throw new Error('degreesPerStep must be positive');
  }

  /**
   * Feeds the next absolute angle in degrees.
   * @returns signed number of whole steps to emit, positive for clockwise.
   */
  update(angle: number): number {
    if (this.previousAngle === null) {
      this.previousAngle = angle;
      return 0;
    }

    this.banked += shortestArc(this.previousAngle, angle);
    this.previousAngle = angle;

    // Only whole steps are emitted; the remainder stays banked so slow, steady
    // rotation still advances rather than being repeatedly rounded away.
    const steps = Math.trunc(this.banked / this.degreesPerStep);
    if (steps !== 0) this.banked -= steps * this.degreesPerStep;
    return steps;
  }

  /**
   * Called when the puck is lifted or the marker is lost. The next angle starts a
   * fresh integration, so setting the puck back down does not emit a giant jump.
   */
  reset(): void {
    this.previousAngle = null;
    this.banked = 0;
  }
}

/**
 * Signed shortest angular distance from `from` to `to`, in (-180, 180].
 *
 * This is what makes the 359 -> 1 degree wrap read as +2 rather than -358. The
 * legacy code instead discarded any frame-to-frame delta above 200 degrees, which
 * silently dropped genuinely fast rotations.
 */
export function shortestArc(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}
