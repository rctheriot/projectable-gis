import { useEffect, useRef } from 'react';
import maplibregl, { type Map as MapLibreMap, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { LoadedStory } from '@/story/loadStory';
import { resolveBudget } from '@/story/loadStory';
import type { StoryLayer } from '@/story/types';
import {
  colorProperty,
  fillColorExpression,
  fillLayerId,
  lineWidthExpression,
  outlineColorExpression,
  outlineLayerId,
  sourceId,
} from './layerSpec';

interface Props {
  loaded: LoadedStory;
  year: number;
  scenarioId: string;
  activeLayerIds: Set<string>;
  /**
   * Table mode locks the camera: the projector and the relief model are fixed
   * relative to each other, so any pan or zoom breaks the registration. Explore
   * mode has no physical model to line up with, so the map is navigable.
   */
  interactive?: boolean;
  /**
   * Projector alignment, applied on top of the fitted view. Base map and layers
   * share one camera, so this moves all of them together.
   */
  align?: { scale: number; offsetX: number; offsetY: number; rotation: number };
}

function budgetFor(layer: StoryLayer, loaded: LoadedStory, scenarioId: string, year: number): number {
  return layer.fill.type === 'buildout' ? resolveBudget(layer.fill.budget, loaded.data, scenarioId, year) : 0;
}

/** True when a layer's colours depend on the selected year or scenario. */
function isTimeVarying(layer: StoryLayer): boolean {
  return (
    layer.fill.type === 'buildout' ||
    layer.fill.type === 'joined-choropleth' ||
    layer.fill.type === 'threshold'
  );
}

/**
 * The initial style: an empty dark background.
 *
 * Neither the base raster nor the vector layers are declared here. An `image`
 * source placed in the initial style never resolves in MapLibre 5, so the style
 * never reaches `load` and the canvas stays black forever. Everything is added
 * once the map is up instead.
 *
 * The table runs offline, so there is no tile server and no glyphs -- and no
 * `glyphs` key at all, because the validator rejects an explicit undefined.
 */
function initialStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {},
    // Pure black: on the table this is an LED projector, so the ocean around the
    // island emits no light and the physical model is not washed out.
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#000000' } }],
  };
}

/** Adds a story's vector layers to a loaded map, bottom-first. */
function addStoryLayers(map: MapLibreMap, loaded: LoadedStory, scenarioId: string, year: number, active: Set<string>) {
  for (const layer of loaded.story.layers) {
    if (map.getSource(sourceId(layer))) continue;
    map.addSource(sourceId(layer), { type: 'geojson', data: layer.data });

    const visibility = active.has(layer.id) ? 'visible' : 'none';
    const budget = budgetFor(layer, loaded, scenarioId, year);

    if (layer.render === 'line') {
      map.addLayer({
        id: fillLayerId(layer),
        type: 'line',
        source: sourceId(layer),
        layout: { visibility, 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          // Driven by the fill mode, exactly like a polygon layer: the flooded
          // highways are a threshold layer, so a static colour would draw every
          // sea level scenario at once regardless of the dial.
          'line-color': fillColorExpression(layer, budget, year),
          'line-width': lineWidthExpression(layer),
          'line-opacity': layer.opacity ?? 1,
        },
      });
      continue;
    }

    map.addLayer({
      id: fillLayerId(layer),
      type: 'fill',
      source: sourceId(layer),
      layout: { visibility },
      paint: {
        'fill-color': fillColorExpression(layer, budget, year),
        'fill-opacity': layer.opacity ?? 0.85,
        // Thousands of small parcels; antialiasing is not worth the fill rate.
        'fill-antialias': false,
      },
    });

    if (layer.outlineColor && layer.outlineColor !== 'transparent') {
      map.addLayer({
        id: outlineLayerId(layer),
        type: 'line',
        source: sourceId(layer),
        layout: { visibility },
        paint: {
          'line-color': outlineColorExpression(layer, budget, year),
          'line-width': typeof layer.lineWidth === 'number' ? Math.max(layer.lineWidth, 0.5) : 0.5,
          'line-opacity': layer.outlineOpacity ?? 0.6,
        },
      });
    }
  }
}

/**
 * Applies projector alignment on top of the fitted view.
 *
 * Scale is a zoom offset (doubling the size is one zoom level), and the offset is
 * in screen pixels, which is how someone nudging the image against a physical model
 * actually thinks about it.
 */
function applyAlign(map: MapLibreMap, align: Props['align']) {
  if (!align) return;
  map.setBearing(align.rotation);
  if (align.offsetX || align.offsetY) map.panBy([align.offsetX, align.offsetY], { duration: 0 });
}

/** Recomputes a layer's paint for the current year and scenario. */
function applyPaint(
  map: MapLibreMap,
  layer: StoryLayer,
  loaded: LoadedStory,
  scenarioId: string,
  year: number,
): void {
  if (!map.getLayer(fillLayerId(layer))) return;
  const budget = budgetFor(layer, loaded, scenarioId, year);
  map.setPaintProperty(fillLayerId(layer), colorProperty(layer), fillColorExpression(layer, budget, year));
  if (map.getLayer(outlineLayerId(layer))) {
    map.setPaintProperty(outlineLayerId(layer), 'line-color', outlineColorExpression(layer, budget, year));
  }
}

export function StoryMap({ loaded, year, scenarioId, activeLayerIds, interactive = false, align }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const instanceRef = useRef<{ map: MapLibreMap; storyId: string } | null>(null);
  const teardownRef = useRef<number | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const readyRef = useRef(false);
  /** The fitted view, before any projector alignment. */
  const baseZoomRef = useRef(0);
  const baseCentreRef = useRef<{ lng: number; lat: number } | null>(null);
  /** Visible layers whose paint matches the current year. */
  const paintedRef = useRef(new Set<string>());

  const { story } = loaded;

  // Read current values from asynchronous callbacks without re-running effects.
  const stateRef = useRef({ year, scenarioId, activeLayerIds, align });
  stateRef.current = { year, scenarioId, activeLayerIds, align };

  // ---- create the map once per story ------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    /*
     * React StrictMode invokes this effect twice in development: mount, clean up,
     * mount again. Rebuilding a map with ~30,000 features for that is wasteful, so
     * teardown is deferred by a task and cancelled if the effect re-runs. The
     * remount reuses the live map; a genuine unmount lets the timer fire.
     */
    if (teardownRef.current !== null) {
      clearTimeout(teardownRef.current);
      teardownRef.current = null;
    }

    // A different story needs a genuinely fresh map.
    if (instanceRef.current && instanceRef.current.storyId !== story.id) {
      observerRef.current?.disconnect();
      observerRef.current = null;
      instanceRef.current.map.remove();
      instanceRef.current = null;
      readyRef.current = false;
    }

    if (!instanceRef.current) {
      const map = new maplibregl.Map({
        container,
        style: initialStyle(),
        interactive,
        attributionControl: false,
        fadeDuration: 0,
      });

      instanceRef.current = { map, storyId: story.id };

      // Keeps the map correct if the projector's output size changes.
      const observer = new ResizeObserver(() => {
        map.resize();
      });
      observer.observe(container);
      observerRef.current = observer;

      // Dev aid: lets you inspect camera, style and layer state from the console
      // while aligning the projector against the physical model.
      if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__storyMap = map;

      // A style or source failure is otherwise silent: the canvas just stays black.
      map.on('error', (event) => console.error('[map]', event.error?.message ?? event));

      map.on('load', () => {
        const [tl, tr, br, bl] = story.baseMap.corners;
        const { scenarioId: currentScenario, year: currentYear, activeLayerIds: currentActive } = stateRef.current;

        map.addSource('base-map', { type: 'image', url: story.baseMap.image, coordinates: [tl, tr, br, bl] });
        map.addLayer({ id: 'base-map', type: 'raster', source: 'base-map', paint: { 'raster-fade-duration': 0 } });

        addStoryLayers(map, loaded, currentScenario, currentYear, currentActive);

        // Frame the raster: south-west then north-east corner. This is the
        // reference view; alignment is applied relative to it.
        map.fitBounds([bl, tr], { padding: 24, animate: false });
        baseZoomRef.current = map.getZoom();
        baseCentreRef.current = map.getCenter();
        applyAlign(map, stateRef.current.align);

        readyRef.current = true;
        paintedRef.current = new Set(
          story.layers.filter((l) => isTimeVarying(l) && currentActive.has(l.id)).map((l) => l.id),
        );

        map.resize();
      });
    }

    mapRef.current = instanceRef.current.map;

    return () => {
      teardownRef.current = window.setTimeout(() => {
        observerRef.current?.disconnect();
        observerRef.current = null;
        instanceRef.current?.map.remove();
        instanceRef.current = null;
        mapRef.current = null;
        readyRef.current = false;
        teardownRef.current = null;
      }, 0);
    };
  }, [story, loaded, interactive]);

  // ---- projector alignment ----------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !align || !baseCentreRef.current) return;

    // Always recompute from the fitted view so nudges do not accumulate.
    map.jumpTo({
      center: baseCentreRef.current,
      zoom: baseZoomRef.current + Math.log2(Math.max(0.05, align.scale)),
      bearing: align.rotation,
    });
    if (align.offsetX || align.offsetY) map.panBy([align.offsetX, align.offsetY], { duration: 0 });
  }, [align]);

  // ---- visibility -------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;

    for (const layer of story.layers) {
      const visible = activeLayerIds.has(layer.id);

      // Hidden time-varying layers are skipped by the year effect, so refresh
      // their paint as they are shown or they would reappear with a stale year.
      if (visible && isTimeVarying(layer) && !paintedRef.current.has(layer.id)) {
        applyPaint(map, layer, loaded, stateRef.current.scenarioId, stateRef.current.year);
        paintedRef.current.add(layer.id);
      }
      if (!visible) paintedRef.current.delete(layer.id);

      for (const id of [fillLayerId(layer), outlineLayerId(layer)]) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
    }
  }, [story, loaded, activeLayerIds]);

  // ---- year / scenario --------------------------------------------------
  // Only layers whose colour depends on time are touched, and each costs a single
  // paint-property update regardless of feature count.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;

    const started = import.meta.env.DEV ? performance.now() : 0;
    let repainted = 0;

    for (const layer of story.layers) {
      if (!isTimeVarying(layer)) continue;
      // A hidden layer is repainted when it is next shown, not now.
      if (!stateRef.current.activeLayerIds.has(layer.id)) continue;

      applyPaint(map, layer, loaded, scenarioId, year);
      paintedRef.current.add(layer.id);
      repainted += 1;
    }

    if (import.meta.env.DEV && repainted > 0) {
      console.log(`[perf] year=${year} repainted ${repainted} layer(s) in ${(performance.now() - started).toFixed(1)}ms`);
    }
  }, [story, loaded, year, scenarioId]);

  return <div ref={containerRef} className="story-map" />;
}
