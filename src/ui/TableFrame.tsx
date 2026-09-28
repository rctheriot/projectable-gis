import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { layoutVars, useSettings } from '@/state/useSettings';

interface Props {
  /** Chart, readouts and title: the upper part of the rail. */
  top: ReactNode;
  /** Drawn inside the puck zone, e.g. the puck halos or calibration targets. */
  pucks: ReactNode;
  /** Floats over the map area, right of the bar: legend, panels, status. */
  area?: ReactNode;
  /** Fills the whole throw, underneath everything else. */
  background?: ReactNode;
  /** Layout mode: shows the regions and lets their edges be dragged. */
  editing?: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Drag tracking on one element via pointer capture, so a fast drag that leaves the
 * handle keeps following the pointer.
 */
function useDrag(onMove: (event: PointerEvent, start: { x: number; y: number }) => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      start.current = { x: event.clientX, y: event.clientY };
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      if (start.current) onMove(event.nativeEvent, start.current);
    },
    onPointerUp: () => {
      start.current = null;
    },
    onPointerCancel: () => {
      start.current = null;
    },
  };
}

/**
 * The table's physical layout, left to right:
 *
 *   rail (chart over puck zone) | bar gap | map area
 *
 * The map fills the whole throw underneath, rather than taking a grid column, so
 * the island's position on the relief model depends only on the projector
 * alignment. Dragging a divider re-lays the panels without moving the island.
 *
 * The bar gap is the 80/20 extrusion crossing the table between the puck area and
 * the model. It is painted black and nothing is placed in it.
 *
 * Tracker coordinates are normalised across the puck zone, so table mode and
 * calibration both render through this component: the zone is the same rectangle
 * in each, by construction.
 */
export function TableFrame({ top, pucks, area, background, editing = false }: Props) {
  const settings = useSettings();
  const frameRef = useRef<HTMLDivElement>(null);

  const bounds = () => frameRef.current?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);

  const railDrag = useDrag((event) => {
    const box = bounds();
    settings.set('railWidth', Math.round(clamp(event.clientX - box.left, 200, box.width - 200)));
  });

  const gapDrag = useDrag((event) => {
    const box = bounds();
    const railRight = box.left + useSettings.getState().railWidth;
    settings.set('barGap', Math.round(clamp(event.clientX - railRight, 0, 400)));
  });

  const splitDrag = useDrag((event) => {
    const box = bounds();
    const split = (event.clientY - box.top) / box.height;
    settings.set('chartSplit', Math.round(clamp(split, 0.1, 0.9) * 1000) / 1000);
  });

  return (
    <div ref={frameRef} className={`table-frame${editing ? ' is-editing' : ''}`} style={layoutVars(settings)}>
      {background ? <div className="table-frame__background">{background}</div> : null}

      <aside className="table-frame__rail">
        <div className="table-frame__top">{top}</div>
        {/*
          The puck zone. Tracker coordinates are normalised across *this* element,
          not the viewport, so table space maps onto the area the camera sees.
        */}
        <div className="puck-zone">
          {pucks}
          <p className="puck-zone__hint">Puck area</p>
        </div>
      </aside>

      <div className="table-frame__gap" aria-hidden>
        {editing ? <span className="table-frame__gapLabel">80/20 bar &middot; {settings.barGap}px</span> : null}
      </div>

      <div className="table-frame__area">{area}</div>

      {editing ? (
        <>
          <div className="layout-handle layout-handle--rail" {...railDrag} title="Drag to set the puck area width">
            <span className="layout-handle__label">{settings.railWidth}px</span>
          </div>
          <div className="layout-handle layout-handle--gap" {...gapDrag} title="Drag to set the bar width">
            <span className="layout-handle__label">gap {settings.barGap}px</span>
          </div>
          <div className="layout-handle layout-handle--split" {...splitDrag} title="Drag to split chart and puck area">
            <span className="layout-handle__label">{Math.round(settings.chartSplit * 100)}% chart</span>
          </div>
        </>
      ) : null}
    </div>
  );
}

interface PanelProps {
  children: ReactNode;
  editing: boolean;
}

/**
 * The layer list, floating in the map area. In layout mode its title bar moves it
 * and its right edge resizes it.
 */
export function FloatingLegend({ children, editing }: PanelProps) {
  const settings = useSettings();
  const origin = useRef({ x: 0, y: 0, width: 0 });

  const remember = () => {
    const { legendX, legendY, legendWidth } = useSettings.getState();
    origin.current = { x: legendX, y: legendY, width: legendWidth };
  };

  const move = useDrag((event, start) => {
    settings.apply({
      legendX: Math.max(0, Math.round(origin.current.x + event.clientX - start.x)),
      legendY: Math.max(0, Math.round(origin.current.y + event.clientY - start.y)),
    });
  });

  const resize = useDrag((event, start) => {
    settings.set('legendWidth', Math.round(clamp(origin.current.width + event.clientX - start.x, 160, 800)));
  });

  return (
    <section className={`floating-legend${editing ? ' is-editing' : ''}`}>
      {editing ? (
        <div
          className="floating-legend__grip"
          {...move}
          onPointerDown={(event) => {
            remember();
            move.onPointerDown(event);
          }}
        >
          Drag to move &middot; {settings.legendX}, {settings.legendY}
        </div>
      ) : null}
      {children}
      {editing ? (
        <div
          className="floating-legend__resize"
          {...resize}
          onPointerDown={(event) => {
            remember();
            resize.onPointerDown(event);
          }}
          title="Drag to resize"
        />
      ) : null}
    </section>
  );
}
