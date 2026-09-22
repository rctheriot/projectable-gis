/**
 * Every story the build script knows about.
 *
 * To add one: write a definition module next to `oahu-story.mjs`, import it here,
 * and add it to this array. `npm run prepare-story` builds them all and writes a
 * combined `stories/index.json`, which is what the landing page lists.
 */
import { oahuEnergy } from './oahu-story.mjs';
import { oahuSeaLevel } from './oahu-sea-level-story.mjs';

export const STORIES = [oahuEnergy, oahuSeaLevel];
