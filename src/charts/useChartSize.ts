import { useLayoutEffect, useRef, useState } from 'react';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Measures a chart's plot box so the SVG can be laid out in real pixels.
 *
 * A fixed viewBox scaled to fit letterboxes whenever the box is a different shape
 * from the drawing -- in the rail, a wide short chart ended up centred with empty
 * space either side. Laying out at the measured size fills the box exactly.
 *
 * `unit` is a type scale: text and padding grow with the chart (so labels stay
 * legible across a table at projector resolution) but by the smaller of the two
 * axes, so a wide, short chart does not get enormous text.
 */
export function useChartSize(referenceWidth: number, referenceHeight: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: referenceWidth, height: referenceHeight });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const unit = clamp(Math.min(size.width / referenceWidth, size.height / referenceHeight), 1, 4);
  return { ref, width: size.width, height: size.height, unit };
}
