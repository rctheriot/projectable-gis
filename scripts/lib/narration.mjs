/**
 * Recorded narration for story tours.
 *
 * `npm run narrate` records each tour step to `assets/narration/<story>/<step>.mp3`
 * and notes, in `manifest.json` beside them, a hash of exactly what was recorded:
 * the text and the voice settings. Those files are committed -- they are the only
 * copy, and re-recording costs money.
 *
 * The story build copies a recording into the bundle only when its hash still
 * matches the step's current narration. Edit a sentence and that step falls back to
 * the browser's own speech until it is recorded again, so a visitor never hears
 * audio that disagrees with the caption on screen.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT } from './paths.mjs';

export const narrationDir = (storyId) => path.join(PROJECT_ROOT, 'assets', 'narration', storyId);

/** Identifies one recording: change the words or the voice and it no longer matches. */
export function narrationHash(text, voice) {
  return createHash('sha256').update(JSON.stringify({ text, voice })).digest('hex').slice(0, 16);
}

export async function readNarrationManifest(storyId) {
  const file = path.join(narrationDir(storyId), 'manifest.json');
  if (!existsSync(file)) return { voice: null, steps: {} };
  return JSON.parse(await readFile(file, 'utf8'));
}

/**
 * Where narration is recorded: an OpenAI-compatible `/v1/audio/speech` endpoint.
 *
 * Read from `scripts/text-to-speech/.env` (gitignored), then the environment:
 *
 *   LITELLM_URL   base URL of a LiteLLM (or any OpenAI-compatible) server
 *   API_KEY       its key
 *   TTS_MODEL     default gpt-4o-mini-tts
 *   TTS_VOICE     default marin (OpenAI's recommendation for gpt-4o-mini-tts)
 *
 * With no LITELLM_URL, OPENAI_API_KEY against api.openai.com works too. The key is
 * used only by `npm run narrate`, in Node; nothing under src/ may reference it.
 */
export async function readTtsConfig() {
  const values = { ...process.env };
  const envFile = path.join(PROJECT_ROOT, 'scripts', 'text-to-speech', '.env');
  if (existsSync(envFile)) {
    for (const line of (await readFile(envFile, 'utf8')).split(/\r?\n/)) {
      const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
      // Tolerate quotes, which people add out of habit.
      if (match) values[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
    }
  }

  const base = values.LITELLM_URL || (values.OPENAI_API_KEY ? 'https://api.openai.com' : '');
  const key = values.LITELLM_URL ? values.API_KEY : values.OPENAI_API_KEY;
  if (!base || !key) return null;

  return {
    endpoint: `${base.replace(/\/+$/, '').replace(/\/v1$/, '')}/v1/audio/speech`,
    key,
    model: values.TTS_MODEL || 'gpt-4o-mini-tts',
    voice: values.TTS_VOICE || 'marin',
  };
}
