import type { PuckFrame, PuckSource } from './types';

/**
 * Consumes puck readings from an external tracker over a WebSocket.
 *
 * This is the seam for moving detection out of the browser into a dedicated
 * process (OpenCV, an AprilTag detector, a depth camera) without touching the
 * application. The tracker is expected to send JSON frames already in table
 * coordinates:
 *
 *   { "t": 12345.6, "pucks": [ { "markerId": 384, "x": 0.42, "y": 0.71,
 *                               "angle": 137.2, "confidence": 0.98 } ] }
 *
 * Reconnects with backoff, so starting the tracker after the display is fine.
 */
export class WebSocketPuckSource implements PuckSource {
  readonly id = 'websocket';
  readonly label = 'External tracker';

  private socket: WebSocket | null = null;
  private emit: ((frame: PuckFrame) => void) | null = null;
  private retryHandle: number | null = null;
  private retryDelay = 500;
  private stopped = false;
  private detail = 'not connected';

  constructor(private readonly url: string) {}

  start(onFrame: (frame: PuckFrame) => void) {
    this.emit = onFrame;
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.retryHandle !== null) window.clearTimeout(this.retryHandle);
    this.retryHandle = null;
    this.socket?.close();
    this.socket = null;
    this.emit = null;
  }

  getStatus() {
    return { connected: this.socket?.readyState === WebSocket.OPEN, detail: this.detail };
  }

  private connect() {
    if (this.stopped) return;

    this.detail = `connecting to ${this.url}`;
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.onopen = () => {
      this.retryDelay = 500;
      this.detail = `connected to ${this.url}`;
    };

    socket.onmessage = (event) => {
      if (!this.emit) return;
      try {
        const payload = JSON.parse(event.data as string) as { pucks?: unknown; t?: number };
        if (!Array.isArray(payload.pucks)) return;
        const t = typeof payload.t === 'number' ? payload.t : performance.now();
        this.emit(
          payload.pucks
            .filter((p): p is Record<string, number> => typeof p === 'object' && p !== null)
            .map((p) => ({
              markerId: Number(p.markerId),
              x: Number(p.x),
              y: Number(p.y),
              angle: Number(p.angle),
              confidence: typeof p.confidence === 'number' ? p.confidence : 1,
              t,
            }))
            .filter((p) => Number.isFinite(p.markerId) && Number.isFinite(p.x) && Number.isFinite(p.y)),
        );
      } catch {
        // A malformed frame is dropped rather than tearing down the connection.
      }
    };

    socket.onclose = () => {
      this.socket = null;
      if (this.stopped) return;
      this.detail = `disconnected, retrying in ${Math.round(this.retryDelay / 100) / 10}s`;
      this.retryHandle = window.setTimeout(() => this.connect(), this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 10_000);
    };

    socket.onerror = () => {
      this.detail = `cannot reach ${this.url}`;
    };
  }
}
