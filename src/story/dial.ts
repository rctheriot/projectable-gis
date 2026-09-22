import type { Story } from './types';

/**
 * How a story's main dial reads.
 *
 * The store always holds an integer, because a puck emits whole steps. A story that
 * scrubs time reads it as a year; one that scrubs sea level reads it as feet, in
 * tenths. Everything user-facing goes through here so the two never diverge.
 */
export function dialLabel(story: Story): string {
  return story.dial?.label ?? 'Year';
}

export function formatDial(story: Story, value: number): string {
  const dial = story.dial;
  if (!dial) return String(value);

  const scaled = value * (dial.scale ?? 1);
  const text = scaled.toFixed(dial.decimals ?? 0);
  return dial.unit ? `${text} ${dial.unit}` : text;
}

/** The dial's range, formatted as a caption such as "0.0-3.2 ft". */
export function formatDialRange(story: Story): string {
  const low = formatDial(story, story.years.min);
  const high = formatDial(story, story.years.max);
  // The unit only needs saying once.
  const unit = story.dial?.unit;
  if (!unit) return `${low}–${high}`;
  return `${low.replace(` ${unit}`, '')}–${high}`;
}
