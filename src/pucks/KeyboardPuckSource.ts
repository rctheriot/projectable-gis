import type { PuckBinding } from '@/story/types';
import type { PuckFrame, PuckSource } from './types';

/**
 * Drives the table from the keyboard, with no cameras attached.
 *
 * This exists so the whole application can be built, demonstrated and debugged
 * away from the rig. It synthesises the same readings the camera tracker emits, so
 * nothing downstream can tell the difference.
 *
 *   1-4          select which puck the arrow keys drive
 *   left/right   rotate the selected puck
 *   W A S D      slide the selected puck around the table
 */
export class KeyboardPuckSource implements PuckSource {
  readonly id = 'keyboard';
  readonly label = 'Keyboard';

  private emit: ((frame: PuckFrame) => void) | null = null;
  private selected = 0;
  private readonly state = new Map<number, { x: number; y: number; angle: number }>();

  constructor(private readonly bindings: PuckBinding[]) {
    // Lay the virtual pucks out in a grid inside the puck zone, roughly where the
    // physical pucks sit on the table.
    const columns = 2;
    bindings.forEach((binding, index) => {
      this.state.set(binding.markerId, {
        x: index % columns === 0 ? 0.28 : 0.72,
        y: 0.28 + Math.floor(index / columns) * 0.44,
        angle: 0,
      });
    });
  }

  start(onFrame: (frame: PuckFrame) => void) {
    this.emit = onFrame;
    window.addEventListener('keydown', this.onKeyDown);
    this.publish();
  }

  stop() {
    window.removeEventListener('keydown', this.onKeyDown);
    this.emit = null;
  }

  getStatus() {
    const binding = this.bindings[this.selected];
    return {
      connected: true,
      detail: binding ? `driving "${binding.label}" (press 1-${this.bindings.length} to switch)` : 'no pucks bound',
    };
  }

  /** Which puck the arrow keys currently drive. */
  getSelectedIndex() {
    return this.selected;
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const digit = Number(event.key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= this.bindings.length) {
      this.selected = digit - 1;
      this.publish();
      return;
    }

    const binding = this.bindings[this.selected];
    if (!binding) return;
    const puck = this.state.get(binding.markerId);
    if (!puck) return;

    // One key press is one detent, which is what the physical puck will feel like.
    const step = binding.degreesPerStep;
    const nudge = event.shiftKey ? 0.01 : 0.04;

    switch (event.key) {
      case 'ArrowLeft': puck.angle -= step; break;
      case 'ArrowRight': puck.angle += step; break;
      case 'w': case 'W': puck.y -= nudge; break;
      case 's': case 'S': puck.y += nudge; break;
      case 'a': case 'A': puck.x -= nudge; break;
      case 'd': case 'D': puck.x += nudge; break;
      default: return;
    }

    event.preventDefault();
    puck.x = Math.min(1, Math.max(0, puck.x));
    puck.y = Math.min(1, Math.max(0, puck.y));
    this.publish();
  };

  private publish() {
    if (!this.emit) return;
    const t = performance.now();
    this.emit(
      [...this.state.entries()].map(([markerId, puck]) => ({
        markerId,
        x: puck.x,
        y: puck.y,
        angle: ((puck.angle % 360) + 360) % 360,
        confidence: 1,
        t,
      })),
    );
  }
}
