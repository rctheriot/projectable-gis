import { useMemo } from 'react';
import type { LoadedStory } from '@/story/loadStory';
import { valueAt } from '@/story/loadStory';
import type { ChartSpec } from '@/story/types';
import { useChartSize } from './useChartSize';

interface Props {
  loaded: LoadedStory;
  spec: ChartSpec;
  scenarioId: string;
  year: number;
}

/** The shape the chart was designed at; it is laid out at whatever size it is given. */
const REF_WIDTH = 320;
const REF_HEIGHT = 168;

/** A 2px gap between neighbouring bars, so fills never touch. */
const BAR_GAP = 2;
const CORNER = 4;

const formatCompact = (value: number) =>
  value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${Math.round(value / 1e3)}k` : `${Math.round(value)}`;

const niceCeiling = (value: number) => {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
};

/**
 * Generation by technology for the selected year.
 *
 * Vertical bars on a shared baseline: the job here is comparing magnitudes across
 * six technologies, and length on a common scale is the encoding people read most
 * accurately. A donut asked viewers to compare angles across a table, which is the
 * hardest possible version of the same question.
 *
 * The scale is fixed across the whole time range rather than to the selected year,
 * so scrubbing the year puck makes bars genuinely grow instead of rescaling the
 * axis underneath them.
 */
export function GenerationBars({ loaded, spec, scenarioId, year }: Props) {
  const { story } = loaded;
  const { ref, width: WIDTH, height: HEIGHT, unit } = useChartSize(REF_WIDTH, REF_HEIGHT);
  const PAD = { top: 18 * unit, right: 4 * unit, bottom: 30 * unit, left: 38 * unit };
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;

  const model = useMemo(() => {
    const source = loaded.data[spec.source];
    if (!source) return null;

    const bars = story.seriesOrder.map((technology) => ({
      technology,
      value: valueAt(source, technology, scenarioId, year),
      color: story.palette[technology] ?? '#8a8a8a',
    }));

    // A stable ceiling: the largest single value any technology reaches in any
    // year of this scenario.
    let peak = 0;
    for (const technology of story.seriesOrder) {
      const series = source[scenarioId]?.[technology];
      if (!series) continue;
      for (const value of series.values()) if (value > peak) peak = value;
    }

    const total = bars.reduce((sum, bar) => sum + bar.value, 0);
    return { bars, ceiling: niceCeiling(peak), total };
  }, [loaded, spec.source, story, scenarioId, year]);

  if (!model) return <div ref={ref} />;

  const slot = plotWidth / model.bars.length;
  const barWidth = Math.max(6, slot - BAR_GAP * unit);
  const yOf = (value: number) => PAD.top + plotHeight - (value / model.ceiling) * plotHeight;
  const ticks = [0, model.ceiling / 2, model.ceiling];

  return (
    <figure className="chart chart--bars">
      <figcaption className="chart__title">
        {spec.title}
        <span className="chart__total">
          {formatCompact(model.total)} <span className="chart__totalUnit">{spec.unit}</span>
        </span>
      </figcaption>

      <div ref={ref} className="chart__plot" style={{ aspectRatio: `${REF_WIDTH} / ${REF_HEIGHT}` }}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width={WIDTH}
        height={HEIGHT}
        role="img"
        aria-label={`${spec.title} by technology for ${year}`}
        className="chart__svg"
        style={{ fontSize: 10 * unit }}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={PAD.left + plotWidth} y1={yOf(tick)} y2={yOf(tick)} className="chart__grid" />
            <text x={PAD.left - 6 * unit} y={yOf(tick) + 3 * unit} className="chart__axisLabel" textAnchor="end">
              {formatCompact(tick)}
            </text>
          </g>
        ))}

        {model.bars.map((bar, index) => {
          const x = PAD.left + index * slot + (BAR_GAP * unit) / 2;
          const top = yOf(bar.value);
          const height = PAD.top + plotHeight - top;
          return (
            <g key={bar.technology}>
              {height > 0.5 ? (
                <rect
                  x={x}
                  y={top}
                  width={barWidth}
                  height={height}
                  // Rounded only at the data end; the baseline stays square.
                  rx={Math.min(CORNER * unit, height / 2)}
                  fill={bar.color}
                >
                  <title>{`${bar.technology}: ${formatCompact(bar.value)} ${spec.unit ?? ''}`}</title>
                </rect>
              ) : null}
              {/* Names sit under the bars, so identity is never colour alone. */}
              <text x={x + barWidth / 2} y={HEIGHT - 16 * unit} className="chart__barLabel" textAnchor="middle">
                {bar.technology}
              </text>
              <text x={x + barWidth / 2} y={HEIGHT - 4 * unit} className="chart__barValue" textAnchor="middle">
                {bar.value > 0 ? formatCompact(bar.value) : '–'}
              </text>
            </g>
          );
        })}
      </svg>
      </div>
    </figure>
  );
}
