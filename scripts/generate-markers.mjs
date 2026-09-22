/**
 * Emits printable fiducial sheets for a story's pucks.
 *
 * Usage: npm run markers [-- --story <id>] [-- --size <mm>]
 *
 * Each marker is written as an SVG at true physical size, with a quiet zone and
 * crop guides. Print at 100% scale (no "fit to page"), on matte stock -- gloss
 * throws the projector's light straight back into the camera.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { PROJECT_ROOT } from './lib/paths.mjs';
import { STORIES } from './lib/stories.mjs';

const require = createRequire(import.meta.url);
const { AR } = require('js-aruco2');

const DICTIONARY = 'ARUCO_MIP_36h12';
/**
 * Marker size in mm. 45mm at ~40cm from the camera is comfortably above the
 * detector's minimum while still fitting a puck you can grip.
 */
const DEFAULT_SIZE_MM = 45;
/** A quiet zone of at least one cell is required; two is safer under a diffuser. */
const QUIET_CELLS = 2;

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? null : args[index + 1];
};

const only = flag('story');
const sizeMm = Number(flag('size') ?? DEFAULT_SIZE_MM);

const dictionary = new AR.Dictionary(DICTIONARY);
/** markSize includes the black border ring. */
const cells = dictionary.markSize;

function markerSvg(id, label) {
  /*
   * `generateSVG` draws into a 10-unit viewBox: a white field across 0..10 with the
   * marker itself (its black border ring included) occupying units 1..9. So one
   * dictionary cell is sizeMm/8, and the group has to be shifted by one cell to put
   * the marker's own edge where we want it.
   */
  const cellMm = sizeMm / cells;
  const quietMm = cellMm * QUIET_CELLS;
  const totalMm = sizeMm + quietMm * 2;
  const labelMm = 6;

  const inner = dictionary
    .generateSVG(id)
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '');

  // Shift so viewBox unit 1 (the marker's edge) lands at the quiet-zone boundary.
  const offsetMm = quietMm - cellMm;

  return `<svg xmlns="http://www.w3.org/2000/svg"
     width="${totalMm}mm" height="${totalMm + labelMm}mm"
     viewBox="0 0 ${totalMm} ${totalMm + labelMm}">
  <rect width="100%" height="100%" fill="#fff"/>
  <g transform="translate(${offsetMm} ${offsetMm}) scale(${cellMm})">
    ${inner}
  </g>
  <!-- Cut on this line: the quiet zone is part of the tag and must survive. -->
  <rect x="0.1" y="0.1" width="${totalMm - 0.2}" height="${totalMm - 0.2}"
        fill="none" stroke="#c8c8c8" stroke-width="0.2" stroke-dasharray="1.5 1.5"/>
  <text x="${totalMm / 2}" y="${totalMm + labelMm - 1.8}" font-family="monospace" font-size="3"
        text-anchor="middle" fill="#666">${DICTIONARY} · id ${id} · ${sizeMm}mm · ${label}</text>
</svg>`;
}

async function main() {
  const stories = only ? STORIES.filter((s) => s.id === only) : STORIES;
  if (stories.length === 0) throw new Error(`No story matches "${only}".`);

  for (const story of stories) {
    const out = path.join(PROJECT_ROOT, 'markers', story.id);
    await mkdir(out, { recursive: true });

    for (const puck of story.pucks) {
      if (puck.markerId >= dictionary.codeList.length) {
        throw new Error(
          `Puck "${puck.label}" uses marker id ${puck.markerId}, but ${DICTIONARY} only has ` +
            `${dictionary.codeList.length} markers (0-${dictionary.codeList.length - 1}).`,
        );
      }
      const file = path.join(out, `${puck.markerId}-${puck.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.svg`);
      await writeFile(file, markerSvg(puck.markerId, puck.label));
      console.log(`  ${path.relative(PROJECT_ROOT, file)}  (${puck.label}, ${puck.degreesPerStep}° per detent)`);
    }
    console.log(`\n${story.pucks.length} markers for "${story.id}" at ${sizeMm}mm. Print at 100% scale, matte.`);
  }
}

main().catch((error) => {
  console.error(`\nFailed: ${error.message}`);
  process.exit(1);
});
