import { useMemo } from 'react';
import { CapacityLine } from '@/charts/CapacityLine';
import { GenerationBars } from '@/charts/GenerationBars';
import { StoryMap } from '@/map/StoryMap';
import { usePucks, type SourceKind } from '@/pucks/usePucks';
import { useStore } from '@/state/useStore';
import type { LoadedStory } from '@/story/loadStory';
import { Legend } from './Legend';
import { PuckOverlay } from './PuckOverlay';

interface Props {
  loaded: LoadedStory;
  sourceKind: SourceKind;
  websocketUrl: string;
  onClose: () => void;
}

/**
 * The projected layout.
 *
 * The left rail lines up with the physical puck area on the table -- the region the
 * cameras underneath actually cover. Its lower half is the puck zone and is kept
 * deliberately clear of interface, because that is where the pucks physically sit.
 * The upper half carries the story's chart and readouts, and the map fills the rest
 * of the throw, over the relief model.
 */
export function TableView({ loaded, sourceKind, websocketUrl, onClose }: Props) {
  const { story } = loaded;

  const year = useStore((s) => s.year);
  const scenarioIndex = useStore((s) => s.scenarioIndex);
  const activeLayerIds = useStore((s) => s.activeLayerIds);
  const armedLayerIndex = useStore((s) => s.armedLayerIndex);
  const setLayerActive = useStore((s) => s.setLayerActive);

  const scenario = story.scenarios[scenarioIndex] ?? story.scenarios[0];
  const armedLayer = story.layers[armedLayerIndex];

  const { pucks, status, sourceLabel } = usePucks(story.pucks, sourceKind, websocketUrl);

  const readouts = useMemo(
    () => ({
      Year: String(year),
      Scenario: scenario?.name ?? '',
      Layer: armedLayer?.name ?? '',
      'Add / Remove': armedLayer && activeLayerIds.has(armedLayer.id) ? 'remove' : 'add',
    }),
    [year, scenario, armedLayer, activeLayerIds],
  );

  return (
    <div className="table-view">
      <aside className="rail">
        <div className="rail__top">
          <header className="rail__header">
            <button type="button" className="rail__back" onClick={onClose}>
              &larr; Stories
            </button>
            <h1 className="rail__title">{story.title}</h1>
          </header>

          <div className="readout-row">
            <div className="readout">
              <span className="readout__label">Year</span>
              <span className="readout__value">{year}</span>
            </div>
            <div className="readout">
              <span className="readout__label">Scenario</span>
              <span className="readout__value readout__value--small">{scenario?.name}</span>
            </div>
          </div>

          {story.charts.map((spec) =>
            spec.type === 'bar' ? (
              <GenerationBars key={spec.id} loaded={loaded} spec={spec} scenarioId={scenario?.id ?? ''} year={year} />
            ) : (
              <CapacityLine key={spec.id} loaded={loaded} spec={spec} scenarioId={scenario?.id ?? ''} year={year} />
            ),
          )}
        </div>

        {/*
          The puck zone. Tracker coordinates are normalised across *this* element,
          not the viewport, so table space maps onto the area the cameras see.
        */}
        <div className="puck-zone">
          <PuckOverlay pucks={pucks} readouts={readouts} />
          <p className="puck-zone__hint">Puck area</p>
        </div>

        <div className="rail__legend">
          <h2 className="rail__sectionTitle">Layers</h2>
          <Legend
            loaded={loaded}
            activeLayerIds={activeLayerIds}
            armedLayerIndex={armedLayerIndex}
            year={year}
            scenarioId={scenario?.id ?? ''}
            onToggle={(id) => setLayerActive(id, !activeLayerIds.has(id))}
          />
          {armedLayer?.description ? <p className="rail__note">{armedLayer.description}</p> : null}
        </div>
      </aside>

      <StoryMap loaded={loaded} year={year} scenarioId={scenario?.id ?? ''} activeLayerIds={activeLayerIds} />

      <footer className="status-bar">
        <span className={`status-bar__dot${status.connected ? ' is-connected' : ''}`} aria-hidden />
        <span>
          {sourceLabel}: {status.detail}
        </span>
      </footer>
    </div>
  );
}
