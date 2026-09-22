import type { PuckState } from '@/pucks/usePucks';

interface Props {
  pucks: PuckState[];
  /** What each puck currently reads, e.g. the armed layer name. */
  readouts: Record<string, string>;
}

/**
 * Halos projected onto the physical pucks.
 *
 * Position comes straight from the tracker's table coordinates -- deliberately not
 * from the map camera -- because the projector and the table are fixed relative to
 * each other. Coupling this to the map would make the halos drift if the map view
 * were ever adjusted.
 */
export function PuckOverlay({ pucks, readouts }: Props) {
  return (
    <div className="puck-overlay" aria-hidden>
      {pucks.map((puck) => (
        <div
          key={puck.binding.markerId}
          className="puck"
          style={{
            left: `${puck.x * 100}%`,
            top: `${puck.y * 100}%`,
            borderColor: puck.binding.color,
            // Only this element moves when a puck slides, so the map never repaints.
            transform: `translate(-50%, -50%) rotate(${puck.angle}deg)`,
          }}
        >
          <span className="puck__tick" style={{ background: puck.binding.color }} />
          <span className="puck__body" style={{ transform: `rotate(${-puck.angle}deg)` }}>
            <span className="puck__label">{puck.binding.label}</span>
            <span className="puck__value">{readouts[puck.binding.label] ?? ''}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
