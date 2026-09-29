/**
 * Records the narration for story tours.
 *
 *   npm run narrate                     every story with a tour
 *   npm run narrate -- --only <story>   one story
 *   npm run narrate -- --dry-run        say what would be recorded, record nothing
 *   npm run narrate -- --force          re-record everything
 *
 * Only steps whose words or voice changed since they were last recorded are sent,
 * so editing one sentence re-records one step. Recordings go to
 * `assets/narration/<story>/` and are committed; run `npm run prepare-story`
 * afterwards to bundle them.
 *
 * Needs a text-to-speech endpoint -- see `readTtsConfig` in lib/narration.mjs.
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { narrationDir, narrationHash, readNarrationManifest, readTtsConfig } from './lib/narration.mjs';
import { STORIES } from './lib/stories.mjs';

/**
 * How the narrator should sound. Part of the recording's identity: change it and
 * every step is re-recorded.
 */
const DELIVERY =
  'You are the narrator of a museum exhibit about Hawaiʻi. Speak warmly and clearly, at an unhurried pace, ' +
  'like a documentary narrator addressing visitors standing around a map table. Pronounce Hawaiian words ' +
  'correctly: Oʻahu is oh-AH-hoo, Hawaiʻi is hah-VAI-ee, Waiʻanae is vai-ah-NAI, Koʻolau is koh-oh-LAU. ' +
  'Pause briefly at the ends of sentences.';

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');

async function record(config, text) {
  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      voice: config.voice,
      input: text,
      instructions: DELIVERY,
      response_format: 'mp3',
    }),
  });
  if (!response.ok) {
    // The body explains model or voice errors; never echo the request, which has the key.
    throw new Error(`speech request failed: ${response.status} ${(await response.text()).slice(0, 300)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  const config = await readTtsConfig();
  if (!config && !dryRun) {
    throw new Error('No text-to-speech endpoint configured. Add LITELLM_URL and API_KEY to scripts/text-to-speech/.env.');
  }
  const voice = { model: config?.model ?? 'gpt-4o-mini-tts', voice: config?.voice ?? 'marin', delivery: DELIVERY };

  const stories = STORIES.filter((story) => story.tour && (!only || story.id === only));
  if (only && stories.length === 0) throw new Error(`No story "${only}" with a tour.`);

  for (const story of stories) {
    const dir = narrationDir(story.id);
    const manifest = await readNarrationManifest(story.id);
    // A voice change invalidates every recording, so start the manifest over.
    const sameVoice = JSON.stringify(manifest.voice) === JSON.stringify(voice);
    const next = { voice, steps: sameVoice ? { ...manifest.steps } : {} };

    console.log(`\n${story.id}: ${story.tour.steps.length} steps, ${voice.model} / ${voice.voice}`);
    let recorded = 0;
    for (const step of story.tour.steps) {
      const hash = narrationHash(step.narration, voice);
      const file = `${step.id}.mp3`;
      const current = next.steps[step.id]?.hash === hash && existsSync(path.join(dir, file));
      if (current && !force) {
        console.log(`  ${step.id.padEnd(14)} up to date`);
        continue;
      }
      if (dryRun) {
        console.log(`  ${step.id.padEnd(14)} would record (${step.narration.split(/\s+/).length} words)`);
        continue;
      }
      const audio = await record(config, step.narration);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, file), audio);
      next.steps[step.id] = { file, hash };
      recorded += 1;
      console.log(`  ${step.id.padEnd(14)} recorded, ${(audio.byteLength / 1024).toFixed(0)} KB`);
      // Save as we go, so an interrupted run keeps what it paid for.
      await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(next, null, 2));
    }

    // Steps that no longer exist in the tour drop out of the manifest.
    const ids = new Set(story.tour.steps.map((step) => step.id));
    for (const id of Object.keys(next.steps)) if (!ids.has(id)) delete next.steps[id];
    if (!dryRun) await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(next, null, 2));
    if (!dryRun) console.log(`  ${recorded} recorded. Run \`npm run prepare-story -- --only ${story.id}\` to bundle.`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
