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
const ROTATE_STEP = 0.25;

/**
 * Lines the projected map up with the physical relief model.
 *
 * The projector is not at a fixed height, so the thrown image is a different size
 * every time the rig is assembled. This has to be done by eye, standing at the
 * table, watching the coastline against the printed one -- so it is a live keyboard
 * mode over the real map rather than numbers in a form.
 *
 * Everything is saved as you go; there is nothing to confirm.
 */
export function AlignOverlay({ onDone }: Props) {
  const settings = useSettings();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const step = event.shiftKey ? FINE : COARSE;
      const scaleStep = event.shiftKey ? 1.002 : SCALE_STEP;

      switch (event.key) {
        case 'ArrowLeft':
          settings.set('mapOffsetX', settings.mapOffsetX - step);
          break;
        case 'ArrowRight':
          settings.set('mapOffsetX', settings.mapOffsetX + step);
          break;
        case 'ArrowUp':
          settings.set('mapOffsetY', settings.mapOffsetY - step);
          break;
        case 'ArrowDown':
          settings.set('mapOffsetY', settings.mapOffsetY + step);
          break;
        case '+':
        case '=':
          settings.set('mapScale', settings.mapScale * scaleStep);
          break;
        case '-':
        case '_':
          settings.set('mapScale', settings.mapScale / scaleStep);
          break;
        case '[':
          settings.set('mapRotation', settings.mapRotation - ROTATE_STEP);
          break;
        case ']':
          settings.set('mapRotation', settings.mapRotation + ROTATE_STEP);
          break;
        case '0':
          settings.set('mapScale', DEFAULT_SETTINGS.mapScale);
          settings.set('mapOffsetX', DEFAULT_SETTINGS.mapOffsetX);
          settings.set('mapOffsetY', DEFAULT_SETTINGS.mapOffsetY);
          settings.set('mapRotation', DEFAULT_SETTINGS.mapRotation);
          break;
        case 'Escape':
        case 'Enter':
          onDone();
          break;
        default:
          return;
      }
      event.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [settings, onDone]);

  return (
    <div className="align">
      <div className="align__panel">
        <h2 className="align__title">Align projection</h2>
        <p className="align__lede">
          Match the coastline to the printed island. Hold <kbd>Shift</kbd> for fine steps.
        </p>

        <dl className="align__keys">
          <div>
            <dt>
              <kbd>&larr;</kbd> <kbd>&rarr;</kbd> <kbd>&uarr;</kbd> <kbd>&darr;</kbd>
            </dt>
            <dd>move</dd>
          </div>
          <div>
            <dt>
              <kbd>+</kbd> <kbd>&minus;</kbd>
            </dt>
            <dd>size</dd>
          </div>
          <div>
            <dt>
              <kbd>[</kbd> <kbd>]</kbd>
            </dt>
            <dd>rotate</dd>
          </div>
          <div>
            <dt>
              <kbd>0</kbd>
            </dt>
            <dd>reset</dd>
          </div>
          <div>
            <dt>
              <kbd>Esc</kbd>
            </dt>
            <dd>done</dd>
          </div>
        </dl>

        <p className="align__values">
          scale {settings.mapScale.toFixed(3)} &middot; offset {Math.round(settings.mapOffsetX)},
          {Math.round(settings.mapOffsetY)} &middot; rotation {settings.mapRotation.toFixed(2)}&deg;
        </p>
        <p className="align__note">Saved automatically to this browser.</p>
      </div>
    </div>
  );
}
