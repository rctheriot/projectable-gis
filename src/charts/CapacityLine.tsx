import { useMemo } from 'react';
import type { LoadedStory } from '@/story/loadStory';
import type { ChartSpec } from '@/story/types';

interface Props {
  loaded: LoadedStory;
  spec: ChartSpec;
  scenarioId: string;
  year: number;
}

const WIDTH = 320;
const HEIGHT = 190;
const PAD = { top: 16, right: 46, bottom: 26, left: 40 };

const plotWidth = WIDTH - PAD.left - PAD.right;
const plotHeight = HEIGHT - PAD.top - PAD.bottom;

const niceCeiling = (value: number) => {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
};

/**
 * Installed capacity over the whole horizon, with a marker on the selected year.
 *
 * A single shared y-axis -- never a second scale. The year marker is what ties the
 * chart to the puck: turning the year dial slides the rule and moves the dots.
 */
export function CapacityLine({ loaded, spec, scenarioId, year }: Props) {
  const { story } = loaded;
  const { min, max } = story.years;

  const model = useMemo(() => {
    const source = loaded.data[spec.source];
    if (!source) return null;

    const series = story.seriesOrder
      .map((technology) => {
        const byYear = source[scenarioId]?.[technology];
        if (!byYear) return null;
        const points: { year: number; value: number }[] = [];
        for (let y = min; y <= max; y += 1) {
          const value = byYear.get(y);
          if (value !== undefined) points.push({ year: y, value });
        }
        return points.length ? { technology, points, color: story.palette[technology] ?? '#8a8a8a' } : null;
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    const peak = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.value)));
    return { series, ceiling: niceCeiling(peak) };
  }, [loaded, spec.source, story, scenarioId, min, max]);

  if (!model || model.series.length === 0) return null;

  const xOf = (value: number) => PAD.left + (max === min ? 0 : ((value - min) / (max - min)) * plotWidth);
  const yOf = (value: number) => PAD.top + plotHeight - (value / model.ceiling) * plotHeight;

  const ticks = [0, model.ceiling / 2, model.ceiling];
  const markerX = xOf(year);

  return (
    <figure className="chart chart--line">
      <figcaption className="chart__title">
        {spec.title}
        <span className="chart__subtitle">{spec.unit}</span>
      </figcaption>

      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={spec.title} className="chart__svg">
        {/* Recessive gridlines, behind the data. */}
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={PAD.left + plotWidth} y1={yOf(tick)} y2={yOf(tick)} className="chart__grid" />
            <text x={PAD.left - 6} y={yOf(tick) + 3} className="chart__axisLabel" textAnchor="end">
              {tick >= 1000 ? `${Math.round(tick / 1000)}k` : tick}
            </text>
          </g>
        ))}

        <line x1={markerX} x2={markerX} y1={PAD.top} y2={PAD.top + plotHeight} className="chart__yearRule" />

        {model.series.map((series) => (
          <path
            key={series.technology}
            d={series.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(p.year)} ${yOf(p.value)}`).join('')}
            fill="none"
            stroke={series.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {/* The selected year's value per series, ringed against the surface. */}
        {model.series.map((series) => {
          const point = series.points.find((p) => p.year === year);
          if (!point) return null;
          return (
            <circle
              key={series.technology}
              cx={markerX}
              cy={yOf(point.value)}
              r={4}
              fill={series.color}
              className="chart__marker"
            >
              <title>{`${series.technology}: ${Math.round(point.value)} ${spec.unit ?? ''}`}</title>
            </circle>
          );
        })}

        {/* Direct labels at the right edge -- four or fewer series, so no legend box. */}
        {model.series.map((series) => {
          const last = series.points[series.points.length - 1];
          if (!last) return null;
          return (
            <text
              key={series.technology}
              x={PAD.left + plotWidth + 5}
              y={yOf(last.value) + 3}
              className="chart__seriesLabel"
              fill={series.color}
            >
              {series.technology}
            </text>
          );
        })}

        {/* The endpoint labels give way to the year marker when it sits on top of them. */}
        {markerX - PAD.left > 18 ? (
          <text x={PAD.left} y={HEIGHT - 8} className="chart__axisLabel">{min}</text>
        ) : null}
        {PAD.left + plotWidth - markerX > 18 ? (
          <text x={PAD.left + plotWidth} y={HEIGHT - 8} className="chart__axisLabel" textAnchor="end">{max}</text>
        ) : null}
        <text x={markerX} y={HEIGHT - 8} className="chart__yearLabel" textAnchor="middle">{year}</text>
      </svg>
    </figure>
  );
}
