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

await check(`import '${pkg.name}/core' resolves and loads`, async () => {
  await import(new URL('../dist/core/index.js', import.meta.url).href);
});

await check('core entry exports the framework-agnostic surface', async () => {
  const m = await import(new URL('../dist/core/index.js', import.meta.url).href);
  for (const name of [
    'createThruClient',
    'createResourceStore',
    'createIdleStore',
    'createPaymentStore',
    'createPlanStore',
    'createSubscriptionStore',
    'isTerminalPaymentStatus',
    'themeToCssVars',
    'mergeTheme',
    'shorten',
    'statusTone',
    'statusLabel',
    'formatDuration',
  ]) {
    assert.equal(typeof m[name], 'function', `expected \`${name}\` to be exported as a function`);
  }
  assert.ok(m.TERMINAL_PAYMENT_STATUSES instanceof Set, 'TERMINAL_PAYMENT_STATUSES should be a Set');
  assert.equal(typeof m.DEFAULT_API_BASE_URL, 'string');
});

// The whole point of the ./core subpath: a Vue/Svelte/vanilla app can install
// this package without React. If any module reachable from dist/core/index.js
// imports react, that promise is broken and `react` cannot be an optional peer.
await check('core entry does not reach React, at runtime or in its types', async () => {
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');

  const seen = new Set();
  const offenders = [];
  const reactImport = /(?:from|import|require)\s*\(?\s*['"]react(?:\/[^'"]*)?['"]/;

  // dist/core re-exports ../client.js, ../format.js, ../types.js, so walk the
  // whole of dist/ that core actually reaches rather than just dist/core.
  const distRoot = fileURLToPath(new URL('../dist/', import.meta.url));

  function walkFrom(relative) {
    if (seen.has(relative)) return;
    seen.add(relative);
    const path = distRoot + relative;
    let source;
    try {
      source = readFileSync(path, 'utf8');
    } catch {
      return;
    }
    if (reactImport.test(source)) offenders.push(relative);
    for (const match of source.matchAll(/['"](\.[^'"]*\.js)['"]/g)) {
      const spec = match[1];
      const base = relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/') + 1) : '';
      const resolved = new URL(spec, `file:///${base}`).pathname.replace(/^\//, '');
      walkFrom(resolved);
    }
  }

  walkFrom('core/index.js');
  walkFrom('core/index.d.ts');
  for (const name of readdirSync(distRoot + 'core')) {
    if (statSync(distRoot + 'core/' + name).isFile()) walkFrom('core/' + name);
  }

  assert.equal(
    offenders.length,
    0,
    `these files are reachable from the ./core entry but import react: ${offenders.join(', ')}`,
  );
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
