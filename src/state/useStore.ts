import { create } from 'zustand';
import type { LoadedStory } from '@/story/loadStory';
import { loadStory } from '@/story/loadStory';
import type { TourView } from '@/story/types';

export type Status = 'idle' | 'loading' | 'ready' | 'error';

/** Where a narrated tour is. While it is anything but `idle`, pucks are ignored. */
export type TourStatus = 'idle' | 'playing' | 'paused';

interface StoreState {
  status: Status;
  error: string | null;
  loaded: LoadedStory | null;

  /** All mutable view state lives here, never on the story definition. */
  year: number;
  scenarioIndex: number;
  activeLayerIds: Set<string>;
  /** Which layer the "add/remove" puck will toggle. */
  armedLayerIndex: number;

  tourStatus: TourStatus;
  tourStep: number;

  openStory: (path: string) => Promise<void>;
  closeStory: () => void;

  stepYear: (delta: number) => void;
  setYear: (year: number) => void;
  stepScenario: (delta: number) => void;
  setScenarioIndex: (index: number) => void;
  stepArmedLayer: (delta: number) => void;
  toggleArmedLayer: () => void;
  setLayerActive: (id: string, active: boolean) => void;

  /** Shows exactly what a tour step describes. */
  applyView: (view: TourView) => void;
  /** Back to how the story opens: first year, first scenario, default layers. */
  resetView: () => void;
  setTour: (status: TourStatus, step?: number) => void;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
/** Wraps an index into [0, length), for controls that cycle. */
const wrap = (value: number, length: number) => ((value % length) + length) % length;

export const useStore = create<StoreState>((set, get) => ({
  status: 'idle',
  error: null,
  loaded: null,
  year: 0,
  scenarioIndex: 0,
  activeLayerIds: new Set(),
  armedLayerIndex: 0,
  tourStatus: 'idle',
  tourStep: 0,

  openStory: async (path) => {
    set({ status: 'loading', error: null });
    try {
      const loaded = await loadStory(path);
      set({
        status: 'ready',
        loaded,
        year: loaded.story.years.min,
        scenarioIndex: 0,
        armedLayerIndex: 0,
        activeLayerIds: new Set(loaded.story.layers.filter((l) => l.defaultActive).map((l) => l.id)),
        tourStatus: 'idle',
        tourStep: 0,
      });
    } catch (error) {
      set({ status: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  },

  closeStory: () =>
    set({ status: 'idle', loaded: null, error: null, activeLayerIds: new Set(), tourStatus: 'idle', tourStep: 0 }),

  stepYear: (delta) => {
    const { loaded, year } = get();
    if (!loaded) return;
    const { min, max } = loaded.story.years;
    if (min === max) return; // Single-year story: the year puck is a no-op.
    const next = clamp(year + delta, min, max);
    if (next !== year) set({ year: next });
  },

  /** Absolute year, for the explore-mode slider. Pucks only ever step. */
  setYear: (year) => {
    const { loaded } = get();
    if (!loaded) return;
    const { min, max } = loaded.story.years;
    set({ year: clamp(Math.round(year), min, max) });
  },

  setScenarioIndex: (index) => {
    const { loaded } = get();
    if (!loaded) return;
    set({ scenarioIndex: wrap(index, loaded.story.scenarios.length) });
  },

  stepScenario: (delta) => {
    const { loaded, scenarioIndex } = get();
    if (!loaded || loaded.story.scenarios.length < 2) return;
    set({ scenarioIndex: wrap(scenarioIndex + delta, loaded.story.scenarios.length) });
  },

  stepArmedLayer: (delta) => {
    const { loaded, armedLayerIndex } = get();
    if (!loaded) return;
    set({ armedLayerIndex: wrap(armedLayerIndex + delta, loaded.story.layers.length) });
  },

  toggleArmedLayer: () => {
    const { loaded, armedLayerIndex, activeLayerIds } = get();
    const layer = loaded?.story.layers[armedLayerIndex];
    if (!layer) return;
    const next = new Set(activeLayerIds);
    if (next.has(layer.id)) next.delete(layer.id);
    else next.add(layer.id);
    set({ activeLayerIds: next });
  },

  setLayerActive: (id, active) => {
    const next = new Set(get().activeLayerIds);
    if (active) next.add(id);
    else next.delete(id);
    set({ activeLayerIds: next });
  },

  applyView: (view) => {
    const { loaded, year, scenarioIndex } = get();
    if (!loaded) return;
    const { min, max } = loaded.story.years;
    const scenario = view.scenario ? loaded.story.scenarios.findIndex((s) => s.id === view.scenario) : -1;
    set({
      year: view.year === undefined ? year : clamp(view.year, min, max),
      scenarioIndex: scenario >= 0 ? scenario : scenarioIndex,
      activeLayerIds: new Set(view.layers),
    });
  },

  resetView: () => {
    const { loaded } = get();
    if (!loaded) return;
    set({
      year: loaded.story.years.min,
      scenarioIndex: 0,
      armedLayerIndex: 0,
      activeLayerIds: new Set(loaded.story.layers.filter((l) => l.defaultActive).map((l) => l.id)),
    });
  },

  setTour: (tourStatus, step) => set(step === undefined ? { tourStatus } : { tourStatus, tourStep: step }),
}));

/** Convenience selectors. */
export const useStory = () => useStore((s) => s.loaded?.story ?? null);
export const useScenarioId = () =>
  useStore((s) => s.loaded?.story.scenarios[s.scenarioIndex]?.id ?? '');
