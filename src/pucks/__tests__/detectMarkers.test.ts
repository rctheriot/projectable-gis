import { AR } from 'js-aruco2';
import { describe, expect, it } from 'vitest';
import { detectMarkers } from '../detectMarkers';

/**
 * Renders a marker from a dictionary into an RGBA frame: black border, data bits
 * (1 = white), and a white quiet zone, on a mid-grey background like a table.
 */
interface Damage {
  /** Border cells (column, row) to paint white, as projector glare would. */
  whiteBorder?: [number, number][];
  /** Pattern bits to flip, by index into the 36-bit code. */
  flipBits?: number[];
}

function renderMarker(
  dictionary: string,
  id: number,
  cell: number,
  damage: Damage = {},
  frame = { width: 480, height: 320 },
) {
  const dict = new AR.Dictionary(dictionary) as unknown as { codeList: string[]; markSize: number };
  const bits = [...dict.codeList[id]!].map((bit, i) => (damage.flipBits?.includes(i) ? (bit === '1' ? '0' : '1') : bit));
  const inner = dict.markSize - 2;
  const data = new Uint8ClampedArray(frame.width * frame.height * 4).fill(128);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;

  const size = (dict.markSize + 2) * cell; // marker plus one quiet cell each side
  const left = Math.round((frame.width - size) / 2);
  const top = Math.round((frame.height - size) / 2);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const cx = Math.floor(x / cell) - 1;
      const cy = Math.floor(y / cell) - 1;
      let white: boolean;
      if (cx < 0 || cy < 0 || cx >= dict.markSize || cy >= dict.markSize) white = true; // quiet zone
      else if (cx === 0 || cy === 0 || cx === dict.markSize - 1 || cy === dict.markSize - 1)
        white = damage.whiteBorder?.some(([bx, by]) => bx === cx && by === cy) ?? false; // border
      else white = bits[(cy - 1) * inner + (cx - 1)] === '1';
      const offset = ((top + y) * frame.width + left + x) * 4;
      const value = white ? 255 : 0;
      data[offset] = data[offset + 1] = data[offset + 2] = value;
    }
  }
  return { ...frame, data };
}

describe('detectMarkers', () => {
  it('reads a new ARUCO_MIP_36h12 puck', () => {
    const { markers, candidates } = detectMarkers(renderMarker('ARUCO_MIP_36h12', 0, 7));
    expect(markers.map((m) => m.id)).toEqual([0]);
    expect(candidates).toBeGreaterThanOrEqual(1);
  });

  /*
   * js-aruco2 dropped the marker in favour of the paper edge around it whenever the
   * two were within 10px, so markers under ~56px (7px cells) were never read. A
   * puck across a room-scale table is often that small.
   */
  it.each([3, 4, 5, 6, 7, 10, 14, 20])('reads a marker with %ipx cells, and nothing else', (cell) => {
    const detection = detectMarkers(renderMarker('ARUCO_MIP_36h12', 0, cell));
    expect(detection.markers.map((m) => m.id)).toEqual([0]);
    // The paper edge around a marker that was read is not a failure.
    expect(detection.rejected).toMatchObject({ pattern: 0 });
  });

  it('finds nothing in a blank frame', () => {
    const data = new Uint8ClampedArray(480 * 320 * 4).fill(200);
    expect(detectMarkers({ width: 480, height: 320, data })).toMatchObject({ markers: [], candidates: 0 });
  });

  // js-aruco2's own check rejects a marker for a single white border cell.
  it('still reads a marker with glare on a border cell', () => {
    const glare: [number, number][] = [[3, 0]];
    const detection = detectMarkers(renderMarker('ARUCO_MIP_36h12', 2, 7, { whiteBorder: glare }));
    expect(detection.markers.map((m) => m.id)).toEqual([2]);
  });

  it('corrects pattern bits up to the tolerance and reports how many', () => {
    const { markers } = detectMarkers(renderMarker('ARUCO_MIP_36h12', 1, 7, { flipBits: [0, 9, 20] }), {
      maxBitErrors: 5,
    });
    expect(markers).toMatchObject([{ id: 1, errors: 3 }]);
  });

  it('rejects a pattern beyond the tolerance and reports the near miss', () => {
    const detection = detectMarkers(renderMarker('ARUCO_MIP_36h12', 1, 7, { flipBits: [0, 9, 20] }), {
      maxBitErrors: 2,
    });
    expect(detection.markers).toEqual([]);
    expect(detection.rejected.pattern).toBeGreaterThanOrEqual(1);
    expect(detection.rejected.nearestMiss).toBe(3);
  });
});
