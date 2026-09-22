import { describe, expect, it } from 'vitest';
import { RotationAccumulator, shortestArc } from '../rotation';

describe('shortestArc', () => {
  it('takes the short way around the wrap point', () => {
    expect(shortestArc(359, 1)).toBeCloseTo(2);
    expect(shortestArc(1, 359)).toBeCloseTo(-2);
    expect(shortestArc(10, 20)).toBeCloseTo(10);
    expect(shortestArc(20, 10)).toBeCloseTo(-10);
  });
});

describe('RotationAccumulator', () => {
  it('emits nothing on the first reading', () => {
    expect(new RotationAccumulator(15).update(42)).toBe(0);
  });

  it('emits one step per whole increment of rotation', () => {
    const rotation = new RotationAccumulator(15);
    rotation.update(0);
    expect(rotation.update(10)).toBe(0); // banked, not yet a whole step
    expect(rotation.update(20)).toBe(1); // 20 degrees total -> one step
    expect(rotation.update(30)).toBe(1); // 30 total -> second step
  });

  it('banks the remainder so slow rotation still advances', () => {
    const rotation = new RotationAccumulator(10);
    rotation.update(0);
    // Six 2-degree nudges add up to 12 degrees: one step, with 2 left banked.
    let steps = 0;
    for (let i = 1; i <= 6; i += 1) steps += rotation.update(i * 2);
    expect(steps).toBe(1);
    // Legacy behaviour would have discarded every one of these as below threshold.
  });

  it('emits several steps at once for a fast turn', () => {
    const rotation = new RotationAccumulator(15);
    rotation.update(0);
    // A 90-degree flick between two frames is six steps, not one.
    expect(rotation.update(90)).toBe(6);
  });

  it('is symmetric for anticlockwise rotation', () => {
    const rotation = new RotationAccumulator(15);
    rotation.update(90);
    expect(rotation.update(0)).toBe(-6);
  });

  it('handles the 360-degree wrap without a spurious jump', () => {
    const rotation = new RotationAccumulator(15);
    rotation.update(350);
    // 350 -> 20 is +30 degrees the short way, i.e. two steps forward.
    expect(rotation.update(20)).toBe(2);
  });

  it('nets out a rotation that goes back where it started', () => {
    const rotation = new RotationAccumulator(15);
    rotation.update(0);
    let steps = rotation.update(45);
    steps += rotation.update(0);
    expect(steps).toBe(0);
  });

  it('does not emit a jump after the puck is lifted and replaced', () => {
    const rotation = new RotationAccumulator(15);
    rotation.update(0);
    rotation.reset();
    expect(rotation.update(180)).toBe(0);
  });

  it('rejects a non-positive step size', () => {
    expect(() => new RotationAccumulator(0)).toThrow();
  });
});
