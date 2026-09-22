import { describe, expect, it } from 'vitest';
import { applyHomography, computeHomography, type Correspondence } from '../homography';

const corner = (cx: number, cy: number, tx: number, ty: number): Correspondence => ({
  camera: { x: cx, y: cy },
  table: { x: tx, y: ty },
});

describe('computeHomography', () => {
  it('recovers an exact mapping from four corners', () => {
    // A 1920x1080 camera looking at the whole table, square-on.
    const h = computeHomography([
      corner(0, 0, 0, 0),
      corner(1920, 0, 1, 0),
      corner(1920, 1080, 1, 1),
      corner(0, 1080, 0, 1),
    ]);
    expect(h).not.toBeNull();

    const centre = applyHomography(h!, 960, 540);
    expect(centre.x).toBeCloseTo(0.5, 6);
    expect(centre.y).toBeCloseTo(0.5, 6);
  });

  it('models perspective, which linear interpolation cannot', () => {
    // A camera mounted off-axis: the far edge of the table is foreshortened.
    const h = computeHomography([
      corner(200, 100, 0, 0),
      corner(1720, 100, 1, 0),
      corner(1920, 980, 1, 1),
      corner(0, 980, 0, 1),
    ])!;

    expect(applyHomography(h, 200, 100).x).toBeCloseTo(0, 6);
    expect(applyHomography(h, 1920, 980).y).toBeCloseTo(1, 6);

    // The centre of the trapezoid is NOT the centre of the table -- exactly the
    // error the old six-point linear interpolation could not express.
    const naiveMid = applyHomography(h, (200 + 1920) / 2, (100 + 980) / 2);
    expect(Math.abs(naiveMid.y - 0.5)).toBeGreaterThan(0.005);
  });

  it('maps both cameras into the same table frame', () => {
    const left = computeHomography([
      corner(0, 0, 0, 0),
      corner(1000, 0, 0.6, 0),
      corner(1000, 800, 0.6, 1),
      corner(0, 800, 0, 1),
    ])!;
    const right = computeHomography([
      corner(0, 0, 0.4, 0),
      corner(1000, 0, 1, 0),
      corner(1000, 800, 1, 1),
      corner(0, 800, 0.4, 1),
    ])!;

    // A puck at table x=0.5 sits in the overlap. Both cameras must agree on it,
    // which is what makes the anti-flicker hack unnecessary.
    const fromLeft = applyHomography(left, (0.5 / 0.6) * 1000, 400);
    const fromRight = applyHomography(right, ((0.5 - 0.4) / 0.6) * 1000, 400);
    expect(fromLeft.x).toBeCloseTo(0.5, 6);
    expect(fromRight.x).toBeCloseTo(0.5, 6);
  });

  it('uses extra points as a least-squares fit instead of discarding them', () => {
    const h = computeHomography([
      corner(0, 0, 0, 0),
      corner(1920, 0, 1, 0),
      corner(1920, 1080, 1, 1),
      corner(0, 1080, 0, 1),
      corner(960, 540, 0.5, 0.5),
      corner(480, 270, 0.25, 0.25),
    ])!;
    expect(applyHomography(h, 960, 540).x).toBeCloseTo(0.5, 5);
  });

  it('returns null for fewer than four points and for collinear ones', () => {
    expect(computeHomography([corner(0, 0, 0, 0)])).toBeNull();
    expect(
      computeHomography([corner(0, 0, 0, 0), corner(1, 1, 1, 1), corner(2, 2, 2, 2), corner(3, 3, 3, 3)]),
    ).toBeNull();
  });
});
