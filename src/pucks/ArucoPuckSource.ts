import type { DetectResponse } from '@/workers/aruco.worker';
import { applyHomography, type Homography } from './homography';
import { loadCalibration } from './calibration';
import type { PuckFrame, PuckReading, PuckSource } from './types';

/** How far back the per-marker hit rate looks. */
const HIT_WINDOW_MS = 2000;

export interface ArucoOptions {
  /** Specific camera, from `navigator.mediaDevices.enumerateDevices()`. */
  deviceId?: string;
  /** Requested capture size. Detection runs at whatever the camera actually gives. */
  width?: number;
  height?: number;
  /** Frames are scaled to this width before detection. See `Settings.detectionWidth`. */
  detectionWidth?: number;
  /** See `Settings.maxBitErrors`. */
  maxBitErrors?: number;
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
 *   - detection runs at a chosen, aspect-correct resolution (default 960 wide),
 *     not a stretched 400x400 canvas;
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
  /** Square outlines found in the last frame, decoded or not. */
  private lastCandidates = 0;
  /**
   * Recent detection outcomes per marker id, as frame timestamps, for a hit rate:
   * the share of recent frames each marker was actually read in.
   */
  private frameTimes: number[] = [];
  /** Rejections per frame over the same window, to say why squares were not read. */
  private rejections: { t: number; border: number; pattern: number; nearestMiss: number | null }[] = [];
  /** Bits corrected on reads in the window: reads near the limit mean the tolerance matters. */
  private readErrors: { t: number; errors: number }[] = [];
  private seenTimes = new Map<number, number[]>();
  /** Mean marker edge length in the last frame, in detection pixels. */
  private lastMarkerSize = 0;
  /** Detection pixels -> native camera pixels. */
  private scale = 1;
  private generation = 0;
  /** The saved camera was not found and the browser default was used instead. */
  private fellBack = false;

  constructor(private readonly options: ArucoOptions = {}) {}

  async start(onFrame: (frame: PuckFrame) => void) {
    // Each start gets a token; stop() invalidates it. React StrictMode runs
    // start/stop/start on the same instance, and without this the first start
    // would carry on past its awaits and leak an open camera and a live worker.
    const run = ++this.generation;
    const stale = () => run !== this.generation;

    this.emit = onFrame;
    this.running = true;

    // The camera opens whether or not there is a calibration: calibrating is how
    // the first one is made, and it needs to see the pucks to do it. Uncalibrated,
    // readings fall back to image-relative coordinates.
    this.homography = loadCalibration()?.homography ?? null;

    // Set before the await so a status read right after start() says what is
    // actually happening: usually the browser's permission prompt.
    this.detail = 'opening camera — allow access if the browser asks';

    let stream: MediaStream;
    try {
      stream = await this.openCamera();
    } catch (error) {
      if (!stale()) this.detail = `no camera: ${error instanceof Error ? error.message : String(error)}`;
      return;
    }
    if (stale()) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    this.stream = stream;

    const video = document.createElement('video');
    video.srcObject = stream;
    video.playsInline = true;
    video.muted = true;
    try {
      await video.play();
    } catch (error) {
      if (!stale()) this.detail = `camera would not play: ${error instanceof Error ? error.message : String(error)}`;
      return;
    }
    if (stale()) return;
    this.video = video;

    this.worker = new Worker(new URL('../workers/aruco.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<DetectResponse>) => this.onMarkers(event.data);

    const track = stream.getVideoTracks()[0];
    const settings = track?.getSettings();
    this.detail = `${settings?.width ?? '?'}x${settings?.height ?? '?'} @ ${settings?.frameRate ?? '?'}fps`;

    void this.pump();
  }

  /**
   * Opens the configured camera, falling back to the browser default if that
   * device is gone -- a saved deviceId goes stale when the camera is swapped or the
   * browser's site data is cleared, and `exact` then fails outright.
   */
  private async openCamera(): Promise<MediaStream> {
    const size = {
      width: { ideal: this.options.width ?? 1920 },
      height: { ideal: this.options.height ?? 1080 },
      // Some webcams default to 15fps or lower at high resolutions; motion blur and
      // dropped detections both get worse as the frame rate falls.
      frameRate: { ideal: 30 },
    };
    if (this.options.deviceId) {
      try {
        return await navigator.mediaDevices.getUserMedia({
          video: { ...size, deviceId: { exact: this.options.deviceId } },
        });
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== 'OverconstrainedError') throw error;
        this.fellBack = true;
      }
    }
    return navigator.mediaDevices.getUserMedia({ video: size });
  }

  stop() {
    this.generation += 1;
    this.running = false;
    this.worker?.terminate();
    this.worker = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video = null;
    this.emit = null;
    this.busy = false;
  }

  /**
   * For each marker read in the last two seconds, the share of frames it was read
   * in. A puck sitting still should be near 100%; a low number is the flicker.
   */
  getHitRates(): { markerId: number; rate: number }[] {
    const frames = this.frameTimes.length;
    if (!frames) return [];
    return [...this.seenTimes]
      .map(([markerId, times]) => ({ markerId, rate: times.length / frames }))
      .sort((a, b) => a.markerId - b.markerId);
  }

  /** The live camera stream, for a preview. Null until the camera has opened. */
  getStream(): MediaStream | null {
    return this.stream;
  }

  getStatus() {
    const parts = [this.detail];
    const rates = this.getHitRates();
    if (this.worker) {
      parts.push(`${this.lastCount} marker(s)`, `${this.lastElapsed.toFixed(0)}ms`);
      if (this.lastCount > 0) parts.push(`markers ~${Math.round(this.lastMarkerSize)}px`);
      parts.push(`${this.lastCandidates} square(s) found`);
      if (rates.length) parts.push(`read ${rates.map((r) => `#${r.markerId} ${Math.round(r.rate * 100)}%`).join(' ')}`);
      const frames = this.rejections.length || 1;
      const border = this.rejections.reduce((sum, r) => sum + r.border, 0) / frames;
      const pattern = this.rejections.reduce((sum, r) => sum + r.pattern, 0) / frames;
      const misses = this.rejections.map((r) => r.nearestMiss).filter((m): m is number => m !== null);
      if (border >= 0.05 || pattern >= 0.05) {
        const nearest = misses.length ? ` (closest ${Math.min(...misses)} bits off)` : '';
        parts.push(`not read per frame: ${border.toFixed(1)} border, ${pattern.toFixed(1)} pattern${nearest}`);
      }
      if (this.readErrors.length) {
        const worst = Math.max(...this.readErrors.map((r) => r.errors));
        parts.push(`reads up to ${worst} bit(s) corrected`);
      }
    }
    if (this.worker && !this.homography) parts.push('not calibrated');
    if (this.fellBack) parts.push('saved camera not found, using default');
    return { connected: this.running && this.worker !== null, detail: parts.join(' · ') };
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
        // createImageBitmap scales on the browser's fast path and hands the frame to
        // the worker without copying it through a main-thread canvas.
        const native = this.video.videoWidth;
        const target = Math.min(native, Math.max(160, this.options.detectionWidth ?? 960));
        const bitmap =
          target < native
            ? await createImageBitmap(this.video, {
                resizeWidth: target,
                resizeHeight: Math.round((this.video.videoHeight * target) / native),
                resizeQuality: 'medium',
              })
            : await createImageBitmap(this.video);
        this.scale = native / bitmap.width;
        this.frameId += 1;
        this.worker.postMessage(
          { type: 'detect', bitmap, frameId: this.frameId, maxBitErrors: this.options.maxBitErrors ?? 5 },
          [bitmap],
        );
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

    // Everything downstream -- calibration, the homography, the preview -- works in
    // native camera pixels, so a calibration stays valid if the detection width
    // changes. Only the detector itself sees the scaled frame.
    const scale = this.scale;
    const width = response.width * scale;
    const height = response.height * scale;
    let edgeSum = 0;
    let edgeCount = 0;

    const t = performance.now();
    const readings: PuckReading[] = [];

    for (const detected of response.markers) {
      if (detected.corners.length < 4) continue;

      const id = detected.id;
      for (let i = 0; i < detected.corners.length; i += 1) {
        const a = detected.corners[i]!;
        const b = detected.corners[(i + 1) % detected.corners.length]!;
        edgeSum += Math.hypot(b.x - a.x, b.y - a.y);
        edgeCount += 1;
      }
      const marker = {
        id,
        corners: detected.corners.map((corner) => ({ x: corner.x * scale, y: corner.y * scale })),
      };

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
        : marker.corners.map((corner) => ({ x: corner.x / width, y: corner.y / height }));

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
        camera: { x: pixelCentre.x, y: pixelCentre.y, width, height },
      });
    }

    this.lastMarkerSize = edgeCount ? edgeSum / edgeCount : 0;
    this.lastCount = readings.length;
    this.lastCandidates = response.candidates;

    // Keep two seconds of history for the hit rate.
    const cutoff = t - HIT_WINDOW_MS;
    this.frameTimes.push(t);
    while (this.frameTimes.length && this.frameTimes[0]! < cutoff) this.frameTimes.shift();
    this.rejections.push({ t, ...response.rejected });
    while (this.rejections.length && this.rejections[0]!.t < cutoff) this.rejections.shift();
    for (const detected of response.markers) this.readErrors.push({ t, errors: detected.errors });
    while (this.readErrors.length && this.readErrors[0]!.t < cutoff) this.readErrors.shift();
    for (const reading of readings) {
      const times = this.seenTimes.get(reading.markerId) ?? [];
      times.push(t);
      this.seenTimes.set(reading.markerId, times);
    }
    for (const [id, times] of this.seenTimes) {
      while (times.length && times[0]! < cutoff) times.shift();
      if (!times.length) this.seenTimes.delete(id);
    }
    this.emit(readings);
  }
}
