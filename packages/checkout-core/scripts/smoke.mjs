// Built-artifact smoke test — mirrors @thru-payment/x402's scripts/smoke.mjs.
//
// tsc alone (no bundler) will happily emit extensionless relative imports
// (`export * from './provider'`) under the wrong moduleResolution setting,
// producing a dist/ that only loads inside a bundler and throws
// ERR_MODULE_NOT_FOUND under Node's own ESM resolver. This package hit that
// exact bug during development. This script runs under plain `node`,
// importing the real build output, so Node's resolver is what's tested.
// Run it after `npm run build`.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const failures = [];

async function check(label, fn) {
  try {
    await fn();
    console.log(`  ok  ${label}`);
  } catch (err) {
    failures.push(`${label}: ${err.message}`);
    console.log(`FAIL  ${label}`);
    console.log(`      ${err.message}`);
  }
}

console.log(`Smoke-testing built output of ${pkg.name}@${pkg.version}\n`);

await check(`import '${pkg.name}' resolves and loads`, async () => {
  await import(new URL('../dist/index.js', import.meta.url).href);
});

await check(`'${pkg.name}' ships type declarations`, async () => {
  const { existsSync } = await import('node:fs');
  assert.ok(existsSync(new URL('../dist/index.d.ts', import.meta.url)), 'missing dist/index.d.ts');
});

await check('main entry exports the documented surface', async () => {
  const m = await import(new URL('../dist/index.js', import.meta.url).href);
  for (const name of [
    'ThruProvider',
    'useThru',
    'createThruClient',
    'usePayment',
    'usePlan',
    'useSubscription',
    'themeToVars',
    'mergeTheme',
    'shorten',
    'statusTone',
    'statusLabel',
    'formatDuration',
  ]) {
    assert.equal(typeof m[name], 'function', `expected \`${name}\` to be exported as a function`);
  }
});

await check('every file in `files` that is not a build artifact exists', async () => {
  const { existsSync } = await import('node:fs');
  for (const rel of pkg.files ?? []) {
    const url = new URL(`../${rel}`, import.meta.url);
    assert.ok(existsSync(url), `package.json "files" lists ${rel}, which does not exist`);
  }
});

console.log('');
if (failures.length > 0) {
  console.error(`${failures.length} smoke check(s) failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('All smoke checks passed.');
