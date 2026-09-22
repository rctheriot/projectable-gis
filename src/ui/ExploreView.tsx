import { useEffect, useRef, useState } from 'react';
import { CapacityLine } from '@/charts/CapacityLine';
import { GenerationBars } from '@/charts/GenerationBars';
import { StoryMap } from '@/map/StoryMap';
import { useStore } from '@/state/useStore';
import type { LoadedStory } from '@/story/loadStory';
import { Legend } from './Legend';

interface Props {
  loaded: LoadedStory;
  onClose: () => void;
}

/** Years advanced per second while playing. */
const PLAYBACK_RATE = 6;

/**
 * The browser version of a story.
 *
 * Same data, same map, same charts as the table -- but driven by ordinary
 * controls instead of pucks, on a navigable map, in a layout that reflows. This is
 * what someone sees when they open the link on a laptop, so it has to stand on its
 * own without anyone in the room to explain it.
 */
export function ExploreView({ loaded, onClose }: Props) {
  const { story } = loaded;
  const singleYear = story.years.min === story.years.max;

  const year = useStore((s) => s.year);
  const setYear = useStore((s) => s.setYear);
  const scenarioIndex = useStore((s) => s.scenarioIndex);
  const setScenarioIndex = useStore((s) => s.setScenarioIndex);
  const activeLayerIds = useStore((s) => s.activeLayerIds);
  const armedLayerIndex = useStore((s) => s.armedLayerIndex);
  const setLayerActive = useStore((s) => s.setLayerActive);

  const scenario = story.scenarios[scenarioIndex] ?? story.scenarios[0];
  const [playing, setPlaying] = useState(false);

  // Animating the year is the closest thing to turning the dial, and it is the
  // fastest way to see what the story is actually about.
  const frameRef = useRef<number | null>(null);
  useEffect(() => {
    if (!playing || singleYear) return;

    let last = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - last) / 1000;
      if (elapsed >= 1 / PLAYBACK_RATE) {
        last = now;
        const next = useStore.getState().year + 1;
        if (next > story.years.max) {
          setPlaying(false);
          return;
        }
        setYear(next);
      }
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [playing, singleYear, story.years.max, setYear]);

  const togglePlay = () => {
    if (year >= story.years.max) setYear(story.years.min);
    setPlaying((p) => !p);
  };

  return (
    <div className="explore">
      <header className="explore__header">
        <div className="explore__titles">
          <button type="button" className="explore__back" onClick={onClose}>
            &larr; All stories
          </button>
          <h1 className="explore__title">{story.title}</h1>
          {story.subtitle ? <p className="explore__subtitle">{story.subtitle}</p> : null}
        </div>

        {story.scenarios.length > 1 ? (
          <div className="segmented" role="group" aria-label="Scenario">
            {story.scenarios.map((option, index) => (
              <button
                key={option.id}
                type="button"
                className={`segmented__option${index === scenarioIndex ? ' is-selected' : ''}`}
                onClick={() => setScenarioIndex(index)}
                aria-pressed={index === scenarioIndex}
                title={option.description}
              >
                {option.name}
              </button>
            ))}
          </div>
        ) : null}
      </header>

      <aside className="explore__panel">
        <section className="explore__section">
          <h2 className="explore__sectionTitle">Layers</h2>
          <Legend
            loaded={loaded}
            activeLayerIds={activeLayerIds}
            armedLayerIndex={armedLayerIndex}
            year={year}
            scenarioId={scenario?.id ?? ''}
            onToggle={(id) => setLayerActive(id, !activeLayerIds.has(id))}
          />
        </section>

        <section className="explore__section">
          {story.charts.map((spec) =>
            spec.type === 'bar' ? (
              <GenerationBars key={spec.id} loaded={loaded} spec={spec} scenarioId={scenario?.id ?? ''} year={year} />
            ) : (
              <CapacityLine key={spec.id} loaded={loaded} spec={spec} scenarioId={scenario?.id ?? ''} year={year} />
            ),
          )}
        </section>
      </aside>

      <StoryMap
        loaded={loaded}
        year={year}
        scenarioId={scenario?.id ?? ''}
        activeLayerIds={activeLayerIds}
        interactive
      />

      {!singleYear ? (
        <footer className="timeline">
          <button
            type="button"
            className="timeline__play"
            onClick={togglePlay}
            aria-label={playing ? 'Pause' : 'Play through the years'}
          >
            {playing ? '❘❘' : '▶'}
          </button>

          <span className="timeline__year">{year}</span>

          <input
            className="timeline__slider"
            type="range"
            min={story.years.min}
            max={story.years.max}
            step={1}
            value={year}
            onChange={(event) => {
              setPlaying(false);
              setYear(Number(event.target.value));
            }}
            aria-label="Year"
          />

          <span className="timeline__bounds">
            {story.years.min}&ndash;{story.years.max}
          </span>
        </footer>
      ) : null}
    </div>
  );
}
