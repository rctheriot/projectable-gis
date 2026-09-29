import { useEffect } from 'react';
import { DEFAULT_SETTINGS, useSettings } from '@/state/useSettings';

interface Props {
  onDone: () => void;
}

/** Pixels per nudge; Shift makes it fine. */
const COARSE = 10;
const FINE = 1;
/** Multiplicative, so scaling feels the same at any size. */
const SCALE_STEP = 1.01;
const SCALE_STEP_FINE = 1.002;
const ROTATE_STEP = 0.25;
const ROTATE_STEP_FINE = 0.05;

type Nudge = 'left' | 'right' | 'up' | 'down' | 'bigger' | 'smaller' | 'ccw' | 'cw';

/**
 * One nudge of the projector alignment.
 *
 * Reads live values rather than a render-time snapshot: holding a key auto-repeats
 * faster than React re-renders, and a snapshot would make each repeat overwrite the
 * last.
 */
function nudge(direction: Nudge, fine: boolean) {
  const settings = useSettings.getState();
  const step = fine ? FINE : COARSE;
  const scale = fine ? SCALE_STEP_FINE : SCALE_STEP;
  const rotate = fine ? ROTATE_STEP_FINE : ROTATE_STEP;

  switch (direction) {
    case 'left':
      return settings.set('mapOffsetX', settings.mapOffsetX - step);
    case 'right':
      return settings.set('mapOffsetX', settings.mapOffsetX + step);
    case 'up':
      return settings.set('mapOffsetY', settings.mapOffsetY - step);
    case 'down':
      return settings.set('mapOffsetY', settings.mapOffsetY + step);
    case 'bigger':
      return settings.set('mapScale', settings.mapScale * scale);
    case 'smaller':
      return settings.set('mapScale', settings.mapScale / scale);
    case 'ccw':
      return settings.set('mapRotation', settings.mapRotation - rotate);
    case 'cw':
      return settings.set('mapRotation', settings.mapRotation + rotate);
  }
}

const KEYS: Record<string, Nudge> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  '+': 'bigger',
  '=': 'bigger',
  '-': 'smaller',
  _: 'smaller',
  '[': 'ccw',
  ']': 'cw',
};

/**
 * Fits the projection to the physical table, in one place.
 *
 * Two jobs, done standing at the table and judged by eye:
 *
 *   - **layout**: while this is open the table shows its regions, and their edges
 *     can be dragged -- puck area width, the gap over the 80/20 bar, the chart/puck
 *     split, and the layer list;
 *   - **alignment**: the map is moved, scaled and rotated until the coastline sits
 *     on the printed one, by keyboard or with the buttons here.
 *
 * The two are independent -- the map fills the throw underneath the panels -- so
 * they can be done in either order. Everything saves as it changes.
 */
export function AdjustPanel({ onDone }: Props) {
  const settings = useSettings();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Enter') {
        event.preventDefault();
        onDone();
        return;
      }
      const direction = KEYS[event.key];
      if (!direction) return;
      event.preventDefault();
      nudge(direction, event.shiftKey);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onDone]);

  const button = (direction: Nudge, label: string, title: string) => (
    <button
      type="button"
      className="adjust__nudge"
      title={`${title} (Shift-click for a fine step)`}
      onClick={(event) => nudge(direction, event.shiftKey)}
    >
      {label}
    </button>
  );

  return (
    <div className="adjust">
      <div className="adjust__head">
        <h2 className="adjust__title">Adjust table</h2>
        <button type="button" className="button button--primary" onClick={onDone}>
          Done
        </button>
      </div>

      <section className="adjust__section">
        <h3 className="adjust__sectionTitle">Layout</h3>
        <p className="adjust__text">
          Drag the highlighted edges: the puck area&rsquo;s width, the gap over the 80/20 bar, and the chart/puck
          split. Move the layer list by its title bar; resize it from its right edge.
        </p>
        <p className="adjust__values">
          puck area {settings.railWidth}px &middot; bar {settings.barGap}px &middot; chart{' '}
          {Math.round(settings.chartSplit * 100)}%
        </p>
        <p className="adjust__warn">Changing the puck area&rsquo;s size means recalibrating the camera.</p>
      </section>

      <section className="adjust__section">
        <div className="adjust__sectionHead">
          <h3 className="adjust__sectionTitle">Map alignment</h3>
          <button
            type="button"
            className="button button--quiet"
            onClick={() =>
              settings.apply({
                mapScale: DEFAULT_SETTINGS.mapScale,
                mapOffsetX: DEFAULT_SETTINGS.mapOffsetX,
                mapOffsetY: DEFAULT_SETTINGS.mapOffsetY,
                mapRotation: DEFAULT_SETTINGS.mapRotation,
              })
            }
          >
            Reset
          </button>
        </div>
        <p className="adjust__text">
          Match the coastline to the printed island. Keys: <kbd>&larr;</kbd>
          <kbd>&rarr;</kbd>
          <kbd>&uarr;</kbd>
          <kbd>&darr;</kbd> move, <kbd>+</kbd>
          <kbd>&minus;</kbd> size, <kbd>[</kbd>
          <kbd>]</kbd> rotate. Hold <kbd>Shift</kbd> for fine steps.
        </p>

        <div className="adjust__pad">
          <div className="adjust__arrows">
            <span />
            {button('up', '↑', 'Move up')}
            <span />
            {button('left', '←', 'Move left')}
            {button('down', '↓', 'Move down')}
            {button('right', '→', 'Move right')}
          </div>
          <div className="adjust__pair">
            {button('smaller', '−', 'Smaller')}
            {button('bigger', '+', 'Bigger')}
          </div>
          <div className="adjust__pair">
            {button('ccw', '↺', 'Rotate anticlockwise')}
            {button('cw', '↻', 'Rotate clockwise')}
          </div>
        </div>

        <p className="adjust__values">
          scale {settings.mapScale.toFixed(3)} &middot; offset {Math.round(settings.mapOffsetX)},{' '}
          {Math.round(settings.mapOffsetY)} &middot; rotation {settings.mapRotation.toFixed(2)}&deg;
        </p>
      </section>

      <p className="adjust__note">
        Saved to this browser as you go. <kbd>Esc</kbd> when done.
      </p>
    </div>
  );
}
