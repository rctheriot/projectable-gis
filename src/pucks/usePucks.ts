import { useEffect, useMemo, useRef, useState } from 'react';
import { useSettings } from '@/state/useSettings';
import { useStore } from '@/state/useStore';
import type { PuckBinding } from '@/story/types';
import { ArucoPuckSource } from './ArucoPuckSource';
import { KeyboardPuckSource } from './KeyboardPuckSource';
import { WebSocketPuckSource } from './WebSocketPuckSource';
import { RotationAccumulator } from './rotation';
import type { PuckFrame, PuckReading, PuckSource } from './types';

export type SourceKind = 'keyboard' | 'camera' | 'websocket';

/** Readings below this are treated as noise. */
const MIN_CONFIDENCE = 0.5;
/**
 * Position smoothing, 0..1: the share of each new reading taken. Detection jitters
 * by a pixel or two frame to frame; this steadies the halo without making it lag a
 * puck that is actually moving.
 */
const SMOOTHING = 0.5;
/** Moves further than this (normalised) snap instead of easing, e.g. a puck set down elsewhere. */
const SNAP_DISTANCE = 0.08;

export interface PuckState extends PuckReading {
  binding: PuckBinding;
}

/**
 * Wires a puck source to the store.
 *
 * Rotation is integrated per puck and dispatched as discrete steps; position is
 * kept in React state only for the on-table overlay. Because the overlay is the
 * only thing that re-renders on movement, sliding a puck around costs nothing on
 * the map.
 */
export function usePucks(bindings: PuckBinding[], kind: SourceKind, websocketUrl: string) {
  const [pucks, setPucks] = useState<PuckState[]>([]);
  const [status, setStatus] = useState({ connected: false, detail: 'starting' });

  const cameraDeviceId = useSettings((s) => s.cameraDeviceId);
  const cameraWidth = useSettings((s) => s.cameraWidth);
  const cameraHeight = useSettings((s) => s.cameraHeight);
  const detectionWidth = useSettings((s) => s.detectionWidth);
  const maxBitErrors = useSettings((s) => s.maxBitErrors);
  // A puck unseen for this long is considered lifted: it disappears and its
  // rotation restarts cleanly when it is next seen.
  const holdMs = useSettings((s) => s.holdMs);
  const holdRef = useRef(holdMs);
  holdRef.current = holdMs;

  const source = useMemo<PuckSource>(() => {
    switch (kind) {
      case 'camera':
        return new ArucoPuckSource({
          deviceId: cameraDeviceId || undefined,
          width: cameraWidth,
          height: cameraHeight,
          detectionWidth,
          maxBitErrors,
        });
      case 'websocket':
        return new WebSocketPuckSource(websocketUrl);
      default:
        return new KeyboardPuckSource(bindings);
    }
  }, [kind, websocketUrl, bindings, cameraDeviceId, cameraWidth, cameraHeight, detectionWidth, maxBitErrors]);

  // Rotation state is per marker and must survive re-renders.
  const rotationsRef = useRef(new Map<number, RotationAccumulator>());
  const lastSeenRef = useRef(new Map<number, number>());
  /** Last known state per puck, shown through brief dropouts. */
  const heldRef = useRef(new Map<number, PuckState>());

  useEffect(() => {
    const rotations = new Map<number, RotationAccumulator>();
    for (const binding of bindings) {
      rotations.set(binding.markerId, new RotationAccumulator(binding.degreesPerStep));
    }
    rotationsRef.current = rotations;
    lastSeenRef.current = new Map();
    heldRef.current = new Map();
  }, [bindings]);

  useEffect(() => {
    const byMarker = new Map(bindings.map((b) => [b.markerId, b]));
    // Secondary markers drive the same puck, for redundancy at the camera edges.
    for (const binding of bindings) {
      if (binding.secondaryMarkerId !== undefined) byMarker.set(binding.secondaryMarkerId, binding);
    }

    const onFrame = (frame: PuckFrame) => {
      const store = useStore.getState();
      const now = performance.now();
      const held = heldRef.current;

      for (const reading of frame) {
        const binding = byMarker.get(reading.markerId);
        if (!binding || reading.confidence < MIN_CONFIDENCE) continue;

        lastSeenRef.current.set(binding.markerId, now);

        // Ease small movements, snap large ones.
        const previous = held.get(binding.markerId);
        const jump = previous ? Math.hypot(reading.x - previous.x, reading.y - previous.y) : Infinity;
        const x = jump > SNAP_DISTANCE ? reading.x : previous!.x + (reading.x - previous!.x) * SMOOTHING;
        const y = jump > SNAP_DISTANCE ? reading.y : previous!.y + (reading.y - previous!.y) * SMOOTHING;
        held.set(binding.markerId, { ...reading, x, y, binding });

        const rotation = rotationsRef.current.get(binding.markerId);
        if (!rotation) continue;

        // The raw angle, not a smoothed one: the integrator already banks the
        // remainder, and smoothing would only delay steps.
        const steps = rotation.update(reading.angle);
        if (steps === 0) continue;

        switch (binding.action.type) {
          case 'year':
            store.stepYear(steps * (binding.action.step ?? 1));
            break;
          case 'scenario':
            store.stepScenario(steps);
            break;
          case 'select-layer':
            store.stepArmedLayer(steps);
            break;
          case 'toggle-layer':
            // Any rotation toggles; direction is deliberately ignored so the
            // puck reads as a single "press" no matter which way it is turned.
            store.toggleArmedLayer();
            break;
        }
      }

      // A puck missed for a frame or two stays where it was. Only once it has been
      // gone longer than the hold is it treated as lifted: it disappears, and its
      // rotation restarts so setting it back down does not replay the difference.
      for (const [markerId, rotation] of rotationsRef.current) {
        const lastSeen = lastSeenRef.current.get(markerId);
        if (lastSeen === undefined || now - lastSeen > holdRef.current) {
          rotation.reset();
          held.delete(markerId);
        }
      }

      const next = [...held.values()];
      setPucks(next);
      setStatus(source.getStatus());
    };

    setStatus(source.getStatus());
    // A camera takes a moment to open (and may wait on a permission prompt), so
    // refresh the status once it has, rather than only when the first frame lands.
    void Promise.resolve(source.start(onFrame)).then(() => setStatus(source.getStatus()));

    return () => source.stop();
  }, [source, bindings]);

  return { pucks, status, sourceLabel: source.label };
}
