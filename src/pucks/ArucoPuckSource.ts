import type { DetectResponse } from '@/workers/aruco.worker';
import { applyHomography, type Homography } from './homography';
import { loadCalibration } from './calibration';
import type { PuckFrame, PuckReading, PuckSource } from './types';

export interface ArucoOptions {
  /** Specific camera, from `navigator.mediaDevices.enumerateDevices()`. */
  deviceId?: string;
  /** Requested capture size. Detection runs at whatever the camera actually gives. */
  width?: number;
  height?: number;
}

/**
 * Reads pucks from a webcam under the table.
 *
 * One camera looks up through the surface at fiducials on the underside of each
 * puck. Detection happens in a worker at the camera's native resolution, and a
 * homography maps camera pixels onto normalised table coordinates.
 *
 * Differences from the version this replaces, all of which caused real problems:
 *
 *   - detection runs at full sensor resolution, not on a 400x400 canvas;
 *   - it runs in a worker, so a slow frame cannot stall rendering;
 *   - position comes from a homography, which models the camera's perspective,
 *     rather than linear interpolation between six points plus arrow-key nudges;
 *   - rotation is measured in table space, so it does not inherit the camera's
 *     own tilt.
 */
export class ArucoPuckSource implements PuckSource {
  readonly id = 'aruco';
  readonly label = 'Camera';

  private emit: ((frame: PuckFrame) => void) | null = null;
  private worker: Worker | null = null;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private running = false;
  private frameId = 0;
  /** One frame in flight at a time: queueing would only add latency. */
  private busy = false;
  private homography: Homography | null = null;
  private detail = 'starting';
  private lastElapsed = 0;
  private lastCount = 0;

  constructor(private readonly options: ArucoOptions = {}) {}

  async start(onFrame: (frame: PuckFrame) => void) {
    this.emit = onFrame;
    this.running = true;

    const calibration = loadCalibration();
    if (!calibration) {
      this.detail = 'not calibrated — run calibration first';
      return;
    }
    this.homography = calibration.homography;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: this.options.deviceId ? { exact: this.options.deviceId } : undefined,
          width: { ideal: this.options.width ?? 1920 },
          height: { ideal: this.options.height ?? 1080 },
        },
      });
    } catch (error) {
      this.detail = `no camera: ${error instanceof Error ? error.message : String(error)}`;
      return;
    }

    const video = document.createElement('video');
    video.srcObject = this.stream;
    video.playsInline = true;
    video.muted = true;
    await video.play();
    this.video = video;

    this.worker = new Worker(new URL('../workers/aruco.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<DetectResponse>) => this.onMarkers(event.data);

    const track = this.stream.getVideoTracks()[0];
    const settings = track?.getSettings();
    this.detail = `${settings?.width ?? '?'}x${settings?.height ?? '?'} @ ${settings?.frameRate ?? '?'}fps`;

    void this.pump();
  }

  stop() {
    this.running = false;
    this.worker?.terminate();
    this.worker = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video = null;
    this.emit = null;
  }

  getStatus() {
    return {
      connected: this.running && this.worker !== null,
      detail: this.homography
        ? `${this.detail} · ${this.lastCount} puck(s) · ${this.lastElapsed.toFixed(0)}ms`
        : this.detail,
    };
  }

  /** Grabs frames as fast as detection can keep up with, never faster. */
  private async pump() {
    while (this.running && this.video && this.worker) {
      if (this.busy || this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        continue;
      }

      this.busy = true;
      try {
        // createImageBitmap hands the frame to the worker without copying it
        // through the main thread's canvas.
        const bitmap = await createImageBitmap(this.video);
        this.frameId += 1;
        this.worker.postMessage({ type: 'detect', bitmap, frameId: this.frameId }, [bitmap]);
      } catch {
        this.busy = false;
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    }
  }

  private onMarkers(response: DetectResponse) {
    this.busy = false;
    if (!this.emit) return;

    this.lastElapsed = response.elapsed;
    this.lastCount = response.markers.length;

    const t = performance.now();
    const readings: PuckReading[] = [];

    for (const marker of response.markers) {
      if (marker.corners.length < 4) continue;

      const pixelCentre = marker.corners.reduce(
        (sum, corner) => ({
          x: sum.x + corner.x / marker.corners.length,
          y: sum.y + corner.y / marker.corners.length,
        }),
        { x: 0, y: 0 },
      );

      // Map every corner into table space first, then measure there: doing the
      // geometry in camera pixels would bake in the camera's perspective and tilt.
      // Uncalibrated, fall back to image-relative coordinates so the calibration
      // screen can still draw what the camera sees.
      const corners = this.homography
        ? marker.corners.map((corner) => applyHomography(this.homography as Homography, corner.x, corner.y))
        : marker.corners.map((corner) => ({ x: corner.x / response.width, y: corner.y / response.height }));

      const [a, b] = corners as [{ x: number; y: number }, { x: number; y: number }];
      const centre = corners.reduce(
        (sum, corner) => ({ x: sum.x + corner.x / corners.length, y: sum.y + corner.y / corners.length }),
        { x: 0, y: 0 },
      );

      // Angle of the marker's first edge, clockwise from north.
      const angle = (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI;

      readings.push({
        markerId: marker.id,
        x: centre.x,
        y: centre.y,
        angle: ((angle % 360) + 360) % 360,
        confidence: 1,
        t,
        camera: { x: pixelCentre.x, y: pixelCentre.y, width: response.width, height: response.height },
      });
    }

    this.emit(readings);
  }
}
