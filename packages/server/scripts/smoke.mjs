// Built-artifact smoke test — mirrors @thru-payment/checkout-core's scripts/smoke.mjs.
//
// Unit tests compile from src/ through ts-jest and will happily pass against a dist/ no consumer
// can import. This runs under plain `node` against the real build output, so Node's own ESM
// resolver is what's tested, and it walks every exports subpath.
//
// It also enforces the promise this package makes that the others do not: it runs on Cloudflare
// Workers. There is no `workerd` in CI, so the check is a static one — nothing in dist/ may import
// a `node:` builtin or touch `Buffer`/`process`. That is a grep, and a grep is exactly right here:
// the failure it prevents is a merchant's production Worker throwing on the first webhook, and it
// would otherwise be found by them rather than by us.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');
const distRoot = fileURLToPath(new URL('../dist/', import.meta.url));

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

await check('main entry exports the documented surface', async () => {
  const m = await import(new URL('../dist/index.js', import.meta.url).href);
  for (const name of [
    'createThruServerClient',
    'verifyThruReturn',
    'constructThruEvent',
    'isCheckoutSessionEvent',
    'hmacHex',
    'safeEqualHex',
  ]) {
    assert.equal(typeof m[name], 'function', `expected \`${name}\` to be exported as a function`);
  }
  for (const name of ['ThruApiError', 'ThruSignatureError']) {
    assert.equal(typeof m[name], 'function', `expected \`${name}\` to be an exported class`);
  }
  assert.equal(typeof m.DEFAULT_API_BASE_URL, 'string');
  assert.equal(m.RETURN_PARAM_SESSION, 'thru_session');
});

for (const [subpath, file] of [
  ['./checkout', 'checkout.js'],
  ['./webhooks', 'webhooks.js'],
]) {
  await check(`import '${pkg.name}${subpath.slice(1)}' resolves and loads`, async () => {
    const m = await import(new URL(`../dist/${file}`, import.meta.url).href);
    assert.ok(Object.keys(m).length > 0, `${subpath} exported nothing`);
  });
}

await check('every exports subpath points at a file that exists', async () => {
  for (const [subpath, entry] of Object.entries(pkg.exports ?? {})) {
    const targets = typeof entry === 'string' ? [entry] : Object.values(entry);
    for (const target of targets) {
      assert.ok(
        existsSync(new URL(`../${target}`, import.meta.url)),
        `exports["${subpath}"] points at ${target}, which does not exist`,
      );
    }
  }
});

// THE Workers contract. `node:crypto`, `Buffer` and `process` are the three things that make an
// otherwise-portable package throw on workerd, and all three are easy to reintroduce by accident —
// a stray `Buffer.from(hex, 'hex')` in a signature helper is the classic one.
await check('dist/ imports no Node builtin and touches no Node global', async () => {
  const offenders = [];
  const nodeImport = /(?:from|import|require)\s*\(?\s*['"]node:[^'"]+['"]/;
  const nodeGlobal = /\b(?:Buffer|process)\b/;

  // Comments are stripped first. Without that the check fires on this package's OWN prose — the
  // docblocks say "no Buffer, no node:crypto" — and a guard that cries wolf on its own
  // documentation gets deleted by the next person, which is worse than not having it.
  const stripComments = (source) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const path = dir + name;
      if (statSync(path).isDirectory()) {
        walk(path + '/');
        continue;
      }
      if (!name.endsWith('.js') && !name.endsWith('.d.ts')) continue;
      const source = stripComments(readFileSync(path, 'utf8'));
      if (nodeImport.test(source)) offenders.push(`${name} (node: import)`);
      if (nodeGlobal.test(source)) offenders.push(`${name} (Buffer/process)`);
    }
  }
  walk(distRoot);

  assert.equal(
    offenders.length,
    0,
    `these built files would break on Cloudflare Workers: ${offenders.join(', ')}`,
  );
});

// The crypto actually has to work, not merely be importable.
await check('hmacHex produces the vector the thru API signs with', async () => {
  const { hmacHex, safeEqualHex } = await import(new URL('../dist/index.js', import.meta.url).href);
  const sig = await hmacHex('k', 'thru.v1|cs_abc|completed|1789560000');
  assert.match(sig, /^[0-9a-f]{64}$/, 'expected lowercase hex');
  assert.equal(await hmacHex('k', 'thru.v1|cs_abc|completed|1789560000'), sig, 'not deterministic');
  assert.notEqual(await hmacHex('k2', 'thru.v1|cs_abc|completed|1789560000'), sig, 'key ignored');
  assert.ok(safeEqualHex(sig, sig));
  assert.ok(!safeEqualHex(sig, 'f'.repeat(64)));
});

await check('a tampered return is rejected by the built artifact', async () => {
  const { verifyThruReturn, hmacHex } = await import(
    new URL('../dist/index.js', import.meta.url).href
  );
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = await hmacHex('s', `thru.v1|cs_1|completed|${ts}`);
  const good = await verifyThruReturn(
    { thru_session: 'cs_1', thru_status: 'completed', thru_ts: ts, thru_sig: sig },
    's',
  );
  assert.equal(good.verified, true);
  const bad = await verifyThruReturn(
    { thru_session: 'cs_1', thru_status: 'cancelled', thru_ts: ts, thru_sig: sig },
    's',
  );
  assert.equal(bad.verified, false);
  assert.equal(bad.status, null, 'a failed verification must expose no status to trust');
});

await check('every file in `files` exists', async () => {
  for (const rel of pkg.files ?? []) {
    assert.ok(
      existsSync(new URL(`../${rel}`, import.meta.url)),
      `package.json "files" lists ${rel}, which does not exist`,
    );
  }
});

console.log('');
if (failures.length > 0) {
  console.error(`${failures.length} smoke check(s) failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('All smoke checks passed.');
