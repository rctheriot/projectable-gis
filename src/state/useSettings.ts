import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MarkerSet } from '@/pucks/detectMarkers';
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
  /**
   * Width, in pixels, that camera frames are scaled to before marker detection.
   *
   * Smaller is faster, which means more frames; markers read reliably from about
   * 30px across in the scaled frame.
   */
  detectionWidth: number;
  /**
   * How long a puck is kept at its last position after the camera loses it, in ms.
   * Single dropped frames are normal; without this a puck blinked out (and its
   * rotation restarted) every time one happened.
   */
  holdMs: number;
  /** Which printed markers the camera looks for: new prints, or the old plastic pucks. */
  markerSet: MarkerSet;
  /**
   * Most wrong pattern bits a marker read may have and still count. The markers'
   * codes are at least 12 bits apart, so up to 5 is always unambiguous; above that
   * a badly misread marker can come out as a *different* marker.
   */
  maxBitErrors: number;
  /** External tracker endpoint, used when the source is `websocket`. */
  trackerUrl: string;

  /**
   * Width of the puck rail in CSS pixels. This maps onto a physical region of the
   * table, so it is a fixed pixel value tuned once to the rig.
   */
  railWidth: number;
  /**
   * Share of the rail's height given to the chart and readouts, 0..1. The rest is
   * the puck zone.
   */
  chartSplit: number;
  /**
   * Dead band between the puck rail and the map, in CSS pixels. The table has an
   * 80/20 extrusion running across it here, so nothing is drawn in it.
   */
  barGap: number;
  /** The layer list, which floats in the map area. Position is from the map area's top-left. */
  legendWidth: number;
  legendX: number;
  legendY: number;
  /** Diameter of the projected puck halo, in CSS pixels. */
  puckSize: number;

  /**
   * Projector alignment: how the map is scaled and shifted to land on the physical
   * relief model.
   *
   * The projector's height above the table is not fixed, so the thrown image is a
   * different size every time the rig is set up. These nudge the map camera -- base
   * map and every layer together, since they share one camera -- until the coastline
   * lines up with the printed one.
   */
  mapScale: number;
  mapOffsetX: number;
  mapOffsetY: number;
  /** Degrees, for a projector that is not square to the table. */
  mapRotation: number;
}

export const DEFAULT_SETTINGS: Settings = {
  puckSource: 'keyboard',
  cameraDeviceId: '',
  cameraWidth: 1920,
  cameraHeight: 1080,
  detectionWidth: 960,
  holdMs: 600,
  markerSet: 'mip',
  maxBitErrors: 5,
  trackerUrl: 'ws://localhost:8765',
  // 27.5% of the rig's 4096px throw, where the legacy app put the map's left edge.
  railWidth: 1120,
  chartSplit: 0.5,
  barGap: 40,
  legendWidth: 280,
  legendX: 24,
  legendY: 24,
  puckSize: 120,
  mapScale: 1,
  mapOffsetX: 0,
  mapOffsetY: 0,
  mapRotation: 0,
};

interface SettingsState extends Settings {
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  /** Applies several values at once, e.g. the settings page's Save. */
  apply: (values: Partial<Settings>) => void;
  reset: () => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (key, value) => set({ [key]: value } as Partial<SettingsState>),
      apply: (values) => set(values),
      reset: () => set({ ...DEFAULT_SETTINGS }),
    }),
    {
      name: 'projectable.settings.v1',
      // Only the data is persisted; the actions are rebuilt on load.
      partialize: (state) => pickSettings(state),
      // A stored file from an older build may be missing keys the app now expects.
      merge: (persisted, current) => ({ ...current, ...DEFAULT_SETTINGS, ...(persisted as Partial<Settings>) }),
    },
  ),
);

/** Just the data, without the store's actions. */
export function pickSettings(state: Settings): Settings {
  return Object.fromEntries(
    Object.keys(DEFAULT_SETTINGS).map((key) => [key, state[key as keyof Settings]]),
  ) as unknown as Settings;
}

/** The layout settings, as CSS custom properties for the table shell. */
export function layoutVars(settings: Settings): Record<string, string> {
  return {
    '--rail-width': `${settings.railWidth}px`,
    '--chart-split': `${settings.chartSplit}`,
    '--bar-gap': `${settings.barGap}px`,
    '--legend-width': `${settings.legendWidth}px`,
    '--legend-x': `${settings.legendX}px`,
    '--legend-y': `${settings.legendY}px`,
    '--puck-size': `${settings.puckSize}px`,
  };
}
