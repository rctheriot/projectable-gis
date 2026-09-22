/// <reference lib="webworker" />
import { AR } from 'js-aruco2';

/**
 * Fiducial detection, off the main thread.
 *
 * Detection runs on every frame at the camera's native resolution, so it must not
 * share a thread with rendering. The legacy version ran the detector inline in a
 * `requestAnimationFrame` loop on a 400x400 canvas -- starving it of pixels *and*
 * stalling the UI on every frame.
 *
 * ARUCO_MIP_36h12 is the dictionary: 36 bits with a minimum Hamming distance of 12,
 * which rejects false positives far better than the original ARUCO dictionary the
 * old app used. 250 markers is ample for a handful of pucks.
 */

interface DetectRequest {
  type: 'detect';
  bitmap: ImageBitmap;
  /** Echoed back so the main thread can drop stale results. */
  frameId: number;
}

export interface DetectedMarker {
  id: number;
  corners: { x: number; y: number }[];
}

export interface DetectResponse {
  type: 'markers';
  frameId: number;
  markers: DetectedMarker[];
  /** Detection time in milliseconds, for the diagnostics panel. */
  elapsed: number;
  width: number;
  height: number;
}

const detector = new AR.Detector({ dictionaryName: 'ARUCO_MIP_36h12' });

let canvas: OffscreenCanvas | null = null;
let context: OffscreenCanvasRenderingContext2D | null = null;

self.onmessage = (event: MessageEvent<DetectRequest>) => {
  const message = event.data;
  if (message.type !== 'detect') return;

  const { bitmap, frameId } = message;
  const started = performance.now();

  // Reuse one canvas; allocating per frame would thrash at 30fps.
  if (!canvas || canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
    canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    context = canvas.getContext('2d', { willReadFrequently: true });
  }

  if (!context) {
    bitmap.close();
    return;
  }

  context.drawImage(bitmap, 0, 0);
  const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
  // The bitmap is owned by this worker; releasing it immediately keeps memory flat.
  bitmap.close();

  const markers = detector.detectImage(image.width, image.height, image.data);

  const response: DetectResponse = {
    type: 'markers',
    frameId,
    markers: markers.map((marker) => ({
      id: marker.id,
      corners: marker.corners.map((corner) => ({ x: corner.x, y: corner.y })),
    })),
    elapsed: performance.now() - started,
    width: image.width,
    height: image.height,
  };

  self.postMessage(response);
};
