/// <reference lib="webworker" />
import { detectMarkers, type DetectedMarker, type MarkerSet, type Rejections } from '@/pucks/detectMarkers';

export type { DetectedMarker } from '@/pucks/detectMarkers';

/**
 * Fiducial detection, off the main thread.
 *
 * Detection runs on every frame, so it must not share a thread with rendering;
 * the legacy version ran the detector inline in a `requestAnimationFrame` loop and
 * stalled the UI on every frame. Frames arrive already scaled to the configured
 * detection width (see `Settings.detectionWidth`).
 *
 * Which markers it looks for is a setting: ARUCO_MIP_36h12 for newly printed pucks,
 * or the original ARUCO dictionary on the old plastic ones (see `MarkerSet`).
 */

interface DetectRequest {
  type: 'detect';
  bitmap: ImageBitmap;
  /** Echoed back so the main thread can drop stale results. */
  frameId: number;
  markerSet: MarkerSet;
  maxBitErrors: number;
}

export interface DetectResponse {
  type: 'markers';
  frameId: number;
  markers: DetectedMarker[];
  /** Square outlines found before decoding; see `Detection.candidates`. */
  candidates: number;
  rejected: Rejections;
  /** Detection time in milliseconds, for the diagnostics panel. */
  elapsed: number;
  width: number;
  height: number;
}

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

  const { markers, candidates, rejected } = detectMarkers(image, {
    markerSet: message.markerSet,
    maxBitErrors: message.maxBitErrors,
  });

  const response: DetectResponse = {
    type: 'markers',
    frameId,
    markers,
    candidates,
    rejected,
    elapsed: performance.now() - started,
    width: image.width,
    height: image.height,
  };

  self.postMessage(response);
};
