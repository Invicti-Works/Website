/**
 * Tests for the contact endpoint.
 *
 * The Worker is not covered by `astro check` -- that only looks at src/ -- so
 * without this nothing exercises worker/ beyond the bundler proving it parses.
 * Run by `npm test`, and by CI on every pull request.
 *
 * No test framework on purpose: this needs Request/Response, which Node has
 * built in, and adding a runner to a site with one test file is not worth the
 * dependency.
 */
import { readFileSync } from 'node:fs';
import { handleContact } from './contact.js';

const post = (body, headers = {}) =>
  new Request('https://invicti.works/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const valid = { name: 'Ada', email: 'ada@example.com', message: 'Need an iOS app.', need: 'mobile' };
let sent = null;
const okFetch = async (url, init) => { sent = { url, init }; return new Response('{}', { status: 200 }); };
const failFetch = async () => new Response('{"error":"secret leaked here"}', { status: 422 });

const cases = [
  ['GET is rejected',            new Request('https://x/api/contact', {headers:{accept:'application/json'}}), {}, 405],
  ['no API key -> 503',          post(valid), {}, 503],
  ['missing name -> 400',        post({ ...valid, name: '' }), { RESEND_API_KEY: 'k' }, 400],
  ['bad email -> 400',           post({ ...valid, email: 'nope' }), { RESEND_API_KEY: 'k' }, 400],
  ['huge message -> 400',        post({ ...valid, message: 'x'.repeat(5001) }), { RESEND_API_KEY: 'k' }, 400],
  ['honeypot -> 200, no send',   post({ ...valid, companyUrl: 'bot' }), { RESEND_API_KEY: 'k' }, 200],
  ['valid -> 200',               post(valid), { RESEND_API_KEY: 'k' }, 200],
];

let failures = 0;
for (const [label, req, env, want] of cases) {
  sent = null;
  globalThis.fetch = okFetch;
  const res = await handleContact(req, env);
  const mark = res.status === want ? 'PASS' : 'FAIL';
  if (mark === 'FAIL') failures++;
  console.log(`${mark}  ${label.padEnd(28)} got ${res.status} want ${want}`);
  if (label.startsWith('honeypot') && sent) { console.log('FAIL  honeypot still called Resend'); failures++; }
}

// Provider failure must not leak the provider's response body.
globalThis.fetch = failFetch;
const res = await handleContact(post(valid), { RESEND_API_KEY: 'k' });
const body = await res.text();
console.log(`${res.status === 502 ? 'PASS' : 'FAIL'}  provider failure -> 502    got ${res.status}`);
console.log(`${body.includes('secret leaked here') ? 'FAIL' : 'PASS'}  provider body not leaked`);
if (res.status !== 502 || body.includes('secret leaked here')) failures++;

// Form-encoded (no-JS path) must get HTML back, not JSON.
globalThis.fetch = okFetch;
const formReq = new Request('https://invicti.works/api/contact', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(valid).toString(),
});
const formRes = await handleContact(formReq, { RESEND_API_KEY: 'k' });
const ct = formRes.headers.get('content-type') ?? '';
console.log(`${ct.includes('text/html') ? 'PASS' : 'FAIL'}  no-JS path returns HTML  (${ct})`);
if (!ct.includes('text/html')) failures++;

// Reply-to must be the enquirer so replying in the inbox reaches them.
const payload = JSON.parse(sent.init.body);
console.log(`${payload.reply_to === valid.email ? 'PASS' : 'FAIL'}  reply_to is the enquirer`);
if (payload.reply_to !== valid.email) failures++;

// The Worker entry point must accept the trailing-slash form of each route:
// the asset layer's auto-trailing-slash handling means either can reach us, and
// a missed OAuth path lands on the 404 page inside the sign-in popup.
const { default: workerEntry } = await import('./index.js');
const assets = { fetch: async () => new Response('asset', { status: 200 }) };

for (const path of ['/api/contact', '/api/contact/']) {
  const res = await workerEntry.fetch(
    new Request(`https://invicti.works${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(valid),
    }),
    { ASSETS: assets },
  );
  // 503 means the contact handler ran (no API key); 200 would mean it fell
  // through to the asset stub instead, which is the bug this guards against.
  const ok = res.status === 503;
  console.log(`${ok ? 'PASS' : 'FAIL'}  routed ${path.padEnd(15)} got ${res.status} want 503`);
  if (!ok) failures++;
}

// The OAuth paths matter more than the contact one here: cms-auth.js re-parses
// the URL off the request it is handed and matches the path exactly, so routing
// the trailing-slash form to it without rewriting the URL produces its own
// empty-bodied 404 -- a blank page in the sign-in popup. Asserting the route is
// "reached" is not enough; this asserts it is *answered*.
for (const path of ['/oauth/authorize', '/oauth/authorize/']) {
  const res = await workerEntry.fetch(
    new Request(`https://invicti.works${path}?provider=github&site_id=invicti.works`),
    { ASSETS: assets, ALLOWED_DOMAINS: 'invicti.works', GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret' },
  );
  // 302 to GitHub is the correct answer with credentials present. A 404, or a
  // 200 from the asset stub, both mean the path never reached the handler.
  const location = res.headers.get('location') ?? '';
  const ok = res.status === 302 && location.startsWith('https://github.com/login/oauth/authorize');
  console.log(`${ok ? 'PASS' : 'FAIL'}  auth ${path.padEnd(19)} got ${res.status} ${location.slice(0, 44)}`);
  if (!ok) failures++;
}

// Configuration the Worker reads must actually be in wrangler.jsonc. A plain
// var set only in the Cloudflare dashboard is deleted by the next deploy --
// that is what made CMS sign-in fail with MISCONFIGURED_CLIENT -- so "it works
// because someone typed it into the dashboard" must not be a thing that passes.
// Secrets are the exception and are deliberately absent here.
const wranglerRaw = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');

// Strip whole-line comments before asserting. The file explains itself at
// length, and several of these keys are named in prose -- a var mentioned only
// in a comment is not a var the Worker will actually receive, and a binding
// that is commented out is not a binding.
const wrangler = wranglerRaw
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('//'))
  .join('\n');

for (const key of [
  'GITHUB_CLIENT_ID',
  'ALLOWED_DOMAINS',
  'CONTACT_TO',
  'CONTACT_FROM',
  'INTAKE_MODEL',
  'INTAKE_EFFORT',
  'INTAKE_MAX_TURNS',
  'INTAKE_DAILY_BUDGET_CENTS',
  'BRIEF_TO',
  'BRIEF_FROM',
]) {
  const present = new RegExp(`"${key}"\\s*:`).test(wrangler);
  console.log(`${present ? 'PASS' : 'FAIL'}  wrangler.jsonc declares ${key}`);
  if (!present) failures++;
}

// The reverse: a secret in the config file would publish it in a public repo.
for (const key of [
  'GITHUB_CLIENT_SECRET',
  'RESEND_API_KEY',
  'ANTHROPIC_API_KEY',
  'TURNSTILE_SECRET_KEY',
  'INTAKE_SALT',
]) {
  const leaked = new RegExp(`"${key}"\\s*:`).test(wrangler);
  console.log(`${leaked ? 'FAIL' : 'PASS'}  wrangler.jsonc does NOT contain ${key}`);
  if (leaked) failures++;
}

// D1 backs the intake route. Two ways to get this wrong, and only one of them
// is allowed to be the committed state.
{
  const bound = /"binding"\s*:\s*"DB"/.test(wrangler);

  if (bound) {
    // Live binding: the id had better be a real UUID. Cloudflare validates
    // bindings before it builds, so anything else fails the deploy in under a
    // second -- and `wrangler deploy --dry-run` will not catch it, because a
    // dry run never talks to the account. That is worth a hard failure.
    const id = wrangler.match(/"database_id"\s*:\s*"([^"]*)"/)?.[1] ?? '';
    const realId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    console.log(
      `${realId ? 'PASS' : 'FAIL'}  the D1 binding's database_id is a real UUID  (${id || 'empty'})`,
    );
    if (!realId) failures++;
  } else {
    // Commented out, which is the correct committed state until someone runs
    // `wrangler d1 create` on the real account. A failure here would leave the
    // branch red for a reason no code change can fix, so it is a warning --
    // and the degraded path it implies is covered by intake.test.mjs.
    const documented = /d1_databases/.test(wranglerRaw);
    console.log(
      `${documented ? 'WARN' : 'FAIL'}  no D1 binding yet — /api/intake will 503 and /build shows the plain form (docs/SETUP.md 12d)`,
    );
    if (!documented) failures++;
  }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
