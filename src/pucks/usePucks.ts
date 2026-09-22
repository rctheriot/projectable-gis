import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/state/useStore';
import type { PuckBinding } from '@/story/types';
import { KeyboardPuckSource } from './KeyboardPuckSource';
import { WebSocketPuckSource } from './WebSocketPuckSource';
import { RotationAccumulator } from './rotation';
import type { PuckFrame, PuckReading, PuckSource } from './types';

export type SourceKind = 'keyboard' | 'websocket';

/** Readings below this are treated as noise. */
const MIN_CONFIDENCE = 0.5;
/** A puck unseen for this long is considered lifted, so rotation restarts cleanly. */
const LIFT_TIMEOUT_MS = 400;

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

  const source = useMemo<PuckSource>(
    () => (kind === 'websocket' ? new WebSocketPuckSource(websocketUrl) : new KeyboardPuckSource(bindings)),
    [kind, websocketUrl, bindings],
  );

  // Rotation state is per marker and must survive re-renders.
  const rotationsRef = useRef(new Map<number, RotationAccumulator>());
  const lastSeenRef = useRef(new Map<number, number>());

  useEffect(() => {
    const rotations = new Map<number, RotationAccumulator>();
    for (const binding of bindings) {
      rotations.set(binding.markerId, new RotationAccumulator(binding.degreesPerStep));
    }
    rotationsRef.current = rotations;
    lastSeenRef.current = new Map();
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
      const next: PuckState[] = [];

      for (const reading of frame) {
        const binding = byMarker.get(reading.markerId);
        if (!binding || reading.confidence < MIN_CONFIDENCE) continue;

        lastSeenRef.current.set(binding.markerId, now);
        next.push({ ...reading, binding });

        const rotation = rotationsRef.current.get(binding.markerId);
        if (!rotation) continue;

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

      // Reset rotation for pucks that have been off the table long enough that
      // putting them back down should not replay the angle difference.
      for (const [markerId, rotation] of rotationsRef.current) {
        const lastSeen = lastSeenRef.current.get(markerId);
        if (lastSeen === undefined || now - lastSeen > LIFT_TIMEOUT_MS) rotation.reset();
      }

      setPucks(next);
      setStatus(source.getStatus());
    };

    void source.start(onFrame);
    setStatus(source.getStatus());

    return () => source.stop();
  }, [source, bindings]);

  return { pucks, status, sourceLabel: source.label };
}
