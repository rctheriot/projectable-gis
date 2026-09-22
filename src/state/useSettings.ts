import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SourceKind } from '@/pucks/usePucks';

/**
 * Rig settings, persisted in the browser.
 *
 * These describe the physical installation -- which camera, how wide the puck area
 * is, where the tracker lives -- so they belong to the machine driving the
 * projector, not to the repository. The old project kept the equivalent numbers in
 * source files that had to be edited and rebuilt.
 *
 * Kept deliberately small: anything that belongs to a *story* lives in its JSON,
 * and anything that belongs to a *session* stays in the URL.
 */
export interface Settings {
  /** Where puck readings come from. A `?pucks=` URL parameter overrides this. */
  puckSource: SourceKind;
  /** Camera `deviceId`; empty means whichever camera the browser picks. */
  cameraDeviceId: string;
  cameraWidth: number;
  cameraHeight: number;
  /** External tracker endpoint, used when the source is `websocket`. */
  trackerUrl: string;

  /**
   * Width of the puck rail in CSS pixels. This maps onto a physical region of the
   * table, so it is a fixed pixel value tuned once to the rig.
   */
  railWidth: number;
  /** Width of the layer list down the rail's inner edge. */
  legendWidth: number;
  /** Diameter of the projected puck halo, in CSS pixels. */
  puckSize: number;
}

export const DEFAULT_SETTINGS: Settings = {
  puckSource: 'keyboard',
  cameraDeviceId: '',
  cameraWidth: 1920,
  cameraHeight: 1080,
  trackerUrl: 'ws://localhost:8765',
  // 27.5% of the rig's 4096px throw, where the legacy app put the map's left edge.
  railWidth: 1120,
  legendWidth: 260,
  puckSize: 120,
};

interface SettingsState extends Settings {
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  reset: () => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (key, value) => set({ [key]: value } as Partial<SettingsState>),
      reset: () => set({ ...DEFAULT_SETTINGS }),
    }),
    {
      name: 'projectable.settings.v1',
      // Only the data is persisted; the actions are rebuilt on load.
      partialize: (state) =>
        Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((key) => [key, state[key as keyof Settings]])),
      // A stored file from an older build may be missing keys the app now expects.
      merge: (persisted, current) => ({ ...current, ...DEFAULT_SETTINGS, ...(persisted as Partial<Settings>) }),
    },
  ),
);

/** The layout settings, as CSS custom properties for the table shell. */
export function layoutVars(settings: Settings): Record<string, string> {
  return {
    '--rail-width': `${settings.railWidth}px`,
    '--legend-width': `${settings.legendWidth}px`,
    '--puck-size': `${settings.puckSize}px`,
  };
}
