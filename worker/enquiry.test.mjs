/**
 * Tests for the enquiry endpoint.
 *
 * The Worker is not covered by `astro check` -- that only looks at src/ -- so
 * without this nothing exercises worker/ beyond the bundler proving it parses.
 * Run by `npm test`, and by CI on every pull request.
 *
 * No test framework on purpose: this needs Request/Response, which Node has
 * built in, and adding a runner to a site with one test file is not worth the
 * dependency.
 */
import { handleEnquiry } from './enquiry.js';

const post = (body, headers = {}) =>
  new Request('https://invicti.works/api/enquiry', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const valid = { name: 'Ada', email: 'ada@example.com', message: 'Need an iOS app.', need: 'mobile' };
let sent = null;
const okFetch = async (url, init) => { sent = { url, init }; return new Response('{}', { status: 200 }); };
const failFetch = async () => new Response('{"error":"secret leaked here"}', { status: 422 });

const cases = [
  ['GET is rejected',            new Request('https://x/api/enquiry', {headers:{accept:'application/json'}}), {}, 405],
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
  const res = await handleEnquiry(req, env);
  const mark = res.status === want ? 'PASS' : 'FAIL';
  if (mark === 'FAIL') failures++;
  console.log(`${mark}  ${label.padEnd(28)} got ${res.status} want ${want}`);
  if (label.startsWith('honeypot') && sent) { console.log('FAIL  honeypot still called Resend'); failures++; }
}

// Provider failure must not leak the provider's response body.
globalThis.fetch = failFetch;
const res = await handleEnquiry(post(valid), { RESEND_API_KEY: 'k' });
const body = await res.text();
console.log(`${res.status === 502 ? 'PASS' : 'FAIL'}  provider failure -> 502    got ${res.status}`);
console.log(`${body.includes('secret leaked here') ? 'FAIL' : 'PASS'}  provider body not leaked`);
if (res.status !== 502 || body.includes('secret leaked here')) failures++;

// Form-encoded (no-JS path) must get HTML back, not JSON.
globalThis.fetch = okFetch;
const formReq = new Request('https://invicti.works/api/enquiry', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(valid).toString(),
});
const formRes = await handleEnquiry(formReq, { RESEND_API_KEY: 'k' });
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

for (const path of ['/api/enquiry', '/api/enquiry/']) {
  const res = await workerEntry.fetch(
    new Request(`https://invicti.works${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(valid),
    }),
    { ASSETS: assets },
  );
  // 503 means the enquiry handler ran (no API key); 200 would mean it fell
  // through to the asset stub instead, which is the bug this guards against.
  const ok = res.status === 503;
  console.log(`${ok ? 'PASS' : 'FAIL'}  routed ${path.padEnd(15)} got ${res.status} want 503`);
  if (!ok) failures++;
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
