import { useEffect, useMemo } from 'react';
import { useStore } from '@/state/useStore';
import type { Tour } from '@/story/types';
import { TourRunner } from './TourRunner';

/**
 * One tour runner per story, plus the keyboard controls.
 *
 * Built for a museum exhibit: a visitor walks up and presses one thing. Space
 * toggles play and pause, so a single USB button (which sends a keypress) can
 * drive it, and Escape stops. Browsers only allow audio after a user gesture, and
 * that press is one.
 */
export function useTourRunner(tour: Tour | undefined): TourRunner | null {
  const runner = useMemo(() => (tour ? new TourRunner(tour) : null), [tour]);

  useEffect(() => () => runner?.dispose(), [runner]);

  useEffect(() => {
    if (!runner) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      const current = useStore.getState().tourStatus;

      if (event.key === ' ') {
        // Also stops a focused button from treating the same press as a click.
        event.preventDefault();
        if (current === 'playing') runner.pause();
        else if (current === 'paused') runner.resume();
        else runner.play(0);
      } else if (event.key === 'Escape' && current !== 'idle') {
        runner.stop();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [runner]);

  return runner;
}

interface PlayProps {
  tour: Tour;
  runner: TourRunner;
}

/** The one thing a visitor presses, beside the story's title. Shown only while no tour runs. */
export function TourPlayButton({ tour, runner }: PlayProps) {
  return (
    <button type="button" className="tour__play" onClick={() => runner.play(0)} title={tour.title}>
      <span className="tour__playIcon" aria-hidden>
        ▶
      </span>
      <span className="tour__playLabel">Play the story</span>
    </button>
  );
}

interface PanelProps {
  tour: Tour;
  runner: TourRunner;
  /**
   * `table` fills the puck zone, which the tour takes over while it plays;
   * `explore` floats over the bottom of the map.
   */
  variant: 'table' | 'explore';
}

/**
 * The current step's headline and caption, with progress and controls.
 *
 * Captions show the full narration, so the story works in a noisy room and for
 * visitors who cannot hear it.
 */
export function TourPanel({ tour, runner, variant }: PanelProps) {
  const status = useStore((s) => s.tourStatus);
  const stepIndex = useStore((s) => s.tourStep);
  const step = tour.steps[stepIndex];

  return (
    <div className={`tour tour--${variant}`} role="region" aria-label="Story">
      <div className="tour__head">
        <span className="tour__count">
          {stepIndex + 1} / {tour.steps.length}
        </span>
        {tour.draft ? <span className="tour__draft">Draft script</span> : null}
        <span className="tour__dots" aria-hidden>
          {tour.steps.map((s, index) => (
            <span key={s.id} className={`tour__dot${index <= stepIndex ? ' is-done' : ''}`} />
          ))}
        </span>
      </div>

      <h2 className="tour__title">{step?.title}</h2>
      {/* The live region lets screen readers follow the captions as they change. */}
      <p className="tour__caption" aria-live="polite">
        {step?.narration}
      </p>

      <div className="tour__controls">
        <button type="button" className="tour__button" onClick={() => runner.skip(-1)} disabled={stepIndex === 0}>
          ◀ Back
        </button>
        {status === 'paused' ? (
          <button type="button" className="tour__button tour__button--main" onClick={() => runner.resume()}>
            ▶ Resume
          </button>
        ) : (
          <button type="button" className="tour__button tour__button--main" onClick={() => runner.pause()}>
            ❚❚ Pause
          </button>
        )}
        <button
          type="button"
          className="tour__button"
          onClick={() => runner.skip(1)}
          disabled={stepIndex >= tour.steps.length - 1}
        >
          Next ▶
        </button>
        <button type="button" className="tour__button" onClick={() => runner.stop()}>
          ■ Stop
        </button>
      </div>
    </div>
  );
}
