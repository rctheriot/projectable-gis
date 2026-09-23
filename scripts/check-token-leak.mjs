/**
 * Proves the HCDP token is not in the built bundle.
 *
 * The credential is shared with another app under the name `VITE_MESONET_API_KEY`,
 * and the `VITE_` prefix is exactly how Vite marks a variable as safe to inline
 * into client code. It is not safe: it is a build-time credential, read in Node.
 *
 * Vite only substitutes `import.meta.env.VITE_*` where source code references it,
 * so nothing leaks as long as nothing references it -- but that is an invariant
 * somebody could break with one autocomplete. This checks the invariant instead of
 * trusting it.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from './lib/paths.mjs';
import { readToken } from './lib/hcdp.mjs';

async function* walk(dir) {
  for (const entry of await readdir(dir)) {
    const full = path.join(dir, entry);
    if ((await stat(full)).isDirectory()) yield* walk(full);
    else yield full;
  }
}

async function main() {
  const token = await readToken(PROJECT_ROOT);
  if (!token) {
    console.log('No token configured; nothing to check.');
    return;
  }

  // A source reference is the only way it can reach the bundle, so flag that too:
  // it is a clearer error than finding the secret in dist afterwards.
  const offenders = [];
  for await (const file of walk(path.join(PROJECT_ROOT, 'src'))) {
    const text = await readFile(file, 'utf8');
    if (/import\.meta\.env\.[A-Z_]*MESONET|import\.meta\.env\.HCDP/.test(text)) {
      offenders.push(path.relative(PROJECT_ROOT, file));
    }
  }

  const dist = path.join(PROJECT_ROOT, 'dist');
  if (existsSync(dist)) {
    for await (const file of walk(dist)) {
      if (!/\.(js|css|html|json|map)$/.test(file)) continue;
      if ((await readFile(file, 'utf8')).includes(token)) {
        offenders.push(path.relative(PROJECT_ROOT, file));
      }
    }
  } else {
    console.log('No dist/ yet — run `npm run build` first for the full check.');
  }

  if (offenders.length > 0) {
    console.error('\nToken would ship to visitors. Found in:');
    for (const file of offenders) console.error(`  ${file}`);
    console.error('\nThe HCDP token is build-time only. Remove the reference.');
    process.exit(1);
  }

  console.log('Token is not referenced in src/ and not present in dist/.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
