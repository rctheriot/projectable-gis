import type { LoadedStory } from '@/story/loadStory';
import { resolveBudget } from '@/story/loadStory';
import type { StoryLayer } from '@/story/types';

interface Props {
  loaded: LoadedStory;
  activeLayerIds: Set<string>;
  armedLayerIndex: number;
  year: number;
  scenarioId: string;
  onToggle: (id: string) => void;
}

/**
 * How much of a layer there is to see at the current year.
 *
 * A buildout layer can legitimately have nothing to draw -- wind's budget is
 * exactly zero in 2016, and rooftop solar has no data before 2018 -- which
 * otherwise reads as "this layer is broken" when someone switches it on.
 */
function layerStatus(layer: StoryLayer, loaded: LoadedStory, scenarioId: string, year: number): string | null {
  const fill = layer.fill;

  if (fill.type === 'joined-choropleth' && fill.firstYear !== undefined && year < fill.firstYear) {
    return `from ${fill.firstYear}`;
  }

  if (fill.type === 'threshold') {
    const level = year * (fill.dialScale ?? 1);
    const reached = fill.levels.filter((stop) => stop.value <= level + 1e-9);
    if (reached.length === 0) return 'none yet';
    return `to ${reached[reached.length - 1]?.label ?? reached[reached.length - 1]?.value}`;
  }

  if (fill.type === 'buildout' && layer.buildoutTotal) {
    const budget = resolveBudget(fill.budget, loaded.data, scenarioId, year);
    const share = Math.min(100, Math.max(0, (budget / layer.buildoutTotal) * 100));
    if (share <= 0) return 'none yet';
    return `${share < 1 ? share.toFixed(1) : Math.round(share)}% built`;
  }

  return null;
}

/**
 * The layer list, which doubles as the state display for the layer pucks.
 *
 * The armed layer -- the one the add/remove puck will act on -- is called out, so
 * people can see what the puck is pointed at before they turn it.
 */
export function Legend({ loaded, activeLayerIds, armedLayerIndex, year, scenarioId, onToggle }: Props) {
  const { story } = loaded;

  return (
    <ul className="legend">
      {story.layers.map((layer, index) => {
        const active = activeLayerIds.has(layer.id);
        const armed = index === armedLayerIndex;
        const status = layerStatus(layer, loaded, scenarioId, year);

        return (
          <li key={layer.id}>
            <button
              type="button"
              className={`legend__item${active ? ' is-active' : ''}${armed ? ' is-armed' : ''}`}
              onClick={() => onToggle(layer.id)}
              aria-pressed={active}
            >
              <span className="legend__swatch" style={{ background: layer.color }} aria-hidden />
              {layer.icon ? <img className="legend__icon" src={layer.icon} alt="" /> : null}
              <span className="legend__text">
                <span className="legend__name">{layer.name}</span>
                {/* Only worth the space once the layer is on. */}
                {active && status ? <span className="legend__status">{status}</span> : null}
              </span>
              <span className="legend__state">{active ? 'on' : 'off'}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
