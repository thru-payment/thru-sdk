// Built-artifact smoke test — deliberately NOT a Jest test.
//
// Jest compiles from `src/` through ts-jest with its own resolver, so a green suite says nothing
// about whether `dist/` can actually be loaded. That gap shipped a `dist/` with extensionless
// relative imports (`export * from './types'`) which threw ERR_MODULE_NOT_FOUND under Node's ESM
// resolver — i.e. the package was unusable in the exact Express-on-Node case it exists for, with
// 28 passing tests.
//
// This script runs under plain `node`, importing the real build output through the package's
// `exports` map, so Node's resolver is the thing being tested. Run it after `npm run build`.

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

// Walk every `exports` subpath rather than a hardcoded list — a new entry point added to
// package.json is covered automatically, including its type declarations.
for (const [subpath, target] of Object.entries(pkg.exports ?? {})) {
  if (subpath === './package.json') continue;

  // Entries are either a bare specifier string or a conditions object ({ types, default }).
  const runtime = typeof target === 'string' ? target : target.default;
  const types = typeof target === 'string' ? undefined : target.types;
  const specifier = `${pkg.name}${subpath.replace(/^\./, '')}`;

  await check(`import '${specifier}' resolves and loads`, async () => {
    assert.ok(runtime, `no runtime target for exports["${subpath}"]`);
    // Targets are package-relative; import as file URLs relative to this script.
    await import(new URL(`../${runtime.replace(/^\.\//, '')}`, import.meta.url).href);
  });

  if (types) {
    await check(`'${specifier}' ships type declarations`, async () => {
      const { existsSync } = await import('node:fs');
      const url = new URL(`../${types.replace(/^\.\//, '')}`, import.meta.url);
      assert.ok(existsSync(url), `missing ${types} — consumers would get \`any\``);
    });
  }
}

await check('main entry exports the documented surface', async () => {
  const m = await import(new URL('../dist/index.js', import.meta.url).href);
  for (const name of [
    'createFacilitatorClient',
    'FacilitatorHttpError',
    'buildChallengeHeaders',
    'extractPayment',
    'decodeRequirementsFromHeader',
    'gateRequest',
  ]) {
    assert.equal(typeof m[name], 'function', `expected \`${name}\` to be exported as a function`);
  }
});

await check('express subpath exports paymentMiddleware', async () => {
  const m = await import(new URL('../dist/express.js', import.meta.url).href);
  assert.equal(typeof m.paymentMiddleware, 'function', 'expected `paymentMiddleware` export');
});

await check('paymentMiddleware is NOT on the main entry (docs must use the subpath)', async () => {
  const m = await import(new URL('../dist/index.js', import.meta.url).href);
  assert.equal(
    m.paymentMiddleware,
    undefined,
    'if this now exists, update the README/console snippets — they tell developers to import it from `@thru-payment/x402/express`',
  );
});

await check('every file in `files` that is not a build artifact exists', async () => {
  const { existsSync } = await import('node:fs');
  for (const rel of pkg.files ?? []) {
    const url = new URL(`../${rel}`, import.meta.url);
    assert.ok(existsSync(url), `package.json "files" lists ${rel}, which does not exist`);
  }
});

await check('the gate challenges an unpaid request end-to-end', async () => {
  // Exercises the built artifact doing real work, not just loading: no payment headers in, a 402
  // challenge with both protocol headers out.
  const { gateRequest } = await import(new URL('../dist/index.js', import.meta.url).href);
  const result = await gateRequest(
    {},
    {
      scheme: 'permit2_exact',
      chain: 'bnb',
      network: 'testnet',
      asset: '0x55d398326f99059fF775485246999027B3197955',
      amountAtomic: 100000n,
      payTo: '0x0000000000000000000000000000000000000001',
      resource: '/smoke',
      maxTimeoutSeconds: 300,
    },
    {
      verify: () => assert.fail('verify must not be called without a payment header'),
      settle: () => assert.fail('settle must not be called without a payment header'),
      supported: () => assert.fail('supported must not be called here'),
    },
    { mppSecret: 'smoke-test-secret' },
  );
  assert.equal(result.kind, 'challenge');
  assert.equal(result.status, 402);
  assert.ok(result.headers['PAYMENT-REQUIRED'], 'missing x402 challenge header');
  assert.ok(
    String(result.headers['WWW-Authenticate']).startsWith('Payment '),
    'missing MPP challenge header',
  );
});

console.log('');
if (failures.length > 0) {
  console.error(`${failures.length} smoke check(s) failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('All smoke checks passed.');
