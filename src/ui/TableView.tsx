import { useEffect, useMemo, useState } from 'react';
import { CapacityLine } from '@/charts/CapacityLine';
import { GenerationBars } from '@/charts/GenerationBars';
import { StoryMap } from '@/map/StoryMap';
import { usePucks, type SourceKind } from '@/pucks/usePucks';
import { DEFAULT_SETTINGS, useSettings } from '@/state/useSettings';
import { useStore } from '@/state/useStore';
import { dialLabel, formatDial, formatDialRange } from '@/story/dial';
import type { LoadedStory } from '@/story/loadStory';
import { AlignOverlay } from './AlignOverlay';
import { Legend } from './Legend';
import { PuckOverlay } from './PuckOverlay';
import { FloatingLegend, TableFrame } from './TableFrame';

interface Props {
  loaded: LoadedStory;
  sourceKind: SourceKind;
  websocketUrl: string;
  onClose: () => void;
  onOpenSettings: () => void;
  onCalibrate: () => void;
}

/**
 * The projected layout.
 *
 * The left rail lines up with the physical puck area on the table -- the region the
 * camera underneath covers. Its lower part is the puck zone and is kept clear of
 * interface, because that is where the pucks physically sit; the chart and readouts
 * sit above it at the rail's full width. The layer list floats in the map area,
 * beside the island it describes. See `TableFrame` for the geometry.
 */
export function TableView({ loaded, sourceKind, websocketUrl, onClose, onOpenSettings, onCalibrate }: Props) {
  const { story } = loaded;

  const year = useStore((s) => s.year);
  const scenarioIndex = useStore((s) => s.scenarioIndex);
  const activeLayerIds = useStore((s) => s.activeLayerIds);
  const armedLayerIndex = useStore((s) => s.armedLayerIndex);
  const setLayerActive = useStore((s) => s.setLayerActive);

  const scenario = story.scenarios[scenarioIndex] ?? story.scenarios[0];
  const armedLayer = story.layers[armedLayerIndex];

  const [mode, setMode] = useState<null | 'align' | 'layout'>(null);
  const mapScale = useSettings((s) => s.mapScale);
  const mapOffsetX = useSettings((s) => s.mapOffsetX);
  const mapOffsetY = useSettings((s) => s.mapOffsetY);
  const mapRotation = useSettings((s) => s.mapRotation);
  const align = useMemo(
    () => ({ scale: mapScale, offsetX: mapOffsetX, offsetY: mapOffsetY, rotation: mapRotation }),
    [mapScale, mapOffsetX, mapOffsetY, mapRotation],
  );
  const { pucks, status, sourceLabel } = usePucks(story.pucks, sourceKind, websocketUrl);

  const readouts = useMemo(
    () => ({
      [dialLabel(story)]: formatDial(story, year),
      Scenario: scenario?.name ?? '',
      Layer: armedLayer?.name ?? '',
      'Add / Remove': armedLayer && activeLayerIds.has(armedLayer.id) ? 'remove' : 'add',
    }),
    [story, year, scenario, armedLayer, activeLayerIds],
  );

  // Esc leaves layout mode; the align overlay handles its own keys.
  useEffect(() => {
    if (mode !== 'layout') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Enter') setMode(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode]);

  const top = (
    <>
      <header className="rail__header">
        <button type="button" className="rail__back" onClick={onClose}>
          &larr; Stories
        </button>
        <h1 className="rail__title">{story.title}</h1>
      </header>

      <div className="readout-row">
        <div className="readout">
          <span className="readout__label">{dialLabel(story)}</span>
          <span className="readout__value">{formatDial(story, year)}</span>
          <span className="readout__range">{formatDialRange(story)}</span>
        </div>
        {story.scenarios.length > 1 ? (
          <div className="readout">
            <span className="readout__label">Scenario</span>
            <span className="readout__value readout__value--small">{scenario?.name}</span>
          </div>
        ) : null}
      </div>

      {story.charts.map((spec) =>
        spec.type === 'bar' ? (
          <GenerationBars key={spec.id} loaded={loaded} spec={spec} scenarioId={scenario?.id ?? ''} year={year} />
        ) : (
          <CapacityLine key={spec.id} loaded={loaded} spec={spec} scenarioId={scenario?.id ?? ''} year={year} />
        ),
      )}
    </>
  );

  const area = (
    <>
      <FloatingLegend editing={mode === 'layout'}>
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
      </FloatingLegend>

      {mode === 'align' ? <AlignOverlay onDone={() => setMode(null)} /> : null}

      {mode === 'layout' ? (
        <div className="layout-panel">
          <h2 className="align__title">Layout</h2>
          <p className="align__lede">
            Drag the highlighted edges to fit the table: the puck area&rsquo;s width, the gap over the 80/20 bar, and
            the split between chart and pucks. Drag the layer list by its title bar.
          </p>
          <p className="align__note">
            Saved automatically. The map does not move. If you change the puck area, recalibrate the camera.
          </p>
          <button type="button" className="button button--primary" onClick={() => setMode(null)}>
            Done
          </button>
        </div>
      ) : null}

      <footer className="status-bar">
        <span className={`status-bar__dot${status.connected ? ' is-connected' : ''}`} aria-hidden />
        <span className="status-bar__detail">
          {sourceLabel}: {status.detail}
        </span>
        <span className="status-bar__actions">
          {sourceKind === 'camera' ? (
            <button type="button" className="status-bar__action" onClick={onCalibrate}>
              Calibrate
            </button>
          ) : null}
          <button
            type="button"
            className={`status-bar__action${mode === 'layout' ? ' is-active' : ''}`}
            onClick={() => setMode(mode === 'layout' ? null : 'layout')}
          >
            Layout
          </button>
          <button
            type="button"
            className={`status-bar__action${mode === 'align' ? ' is-active' : ''}`}
            onClick={() => setMode(mode === 'align' ? null : 'align')}
          >
            Align
          </button>
          <button type="button" className="status-bar__action" onClick={onOpenSettings}>
            Settings
          </button>
        </span>
      </footer>
    </>
  );

  return (
    <div className="table-view">
      <TableFrame
        editing={mode === 'layout'}
        top={top}
        pucks={<PuckOverlay pucks={pucks} readouts={readouts} />}
        area={area}
        background={
          <StoryMap
            loaded={loaded}
            year={year}
            scenarioId={scenario?.id ?? ''}
            activeLayerIds={activeLayerIds}
            align={align}
            reserveLeft={DEFAULT_SETTINGS.railWidth + DEFAULT_SETTINGS.barGap}
          />
        }
      />
    </div>
  );
}
