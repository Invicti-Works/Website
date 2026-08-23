/**
 * Tests for the founders' console.
 *
 * The point of this file is the first half: everything behind /api/console is
 * other people's confidential business information, and the only thing between
 * it and the open internet is the Access assertion check. So these tests sign
 * real RS256 tokens with a real generated keypair and serve a real JWKS
 * document, rather than stubbing the verifier out. A stubbed verifier would
 * pass whatever it was told to pass, which is exactly the bug worth catching.
 *
 * No framework, no network, no database — same posture as the other two test
 * files.
 */
import { handleConsole, buildSpec, slugify } from './console.js';
import { resetAccessKeyCache } from './lib/access.js';
import { memoryStore } from './intake-store.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
};

/* ------------------------------------------------------------ crypto set-up */

const TEAM = 'invicti.cloudflareaccess.com';
const AUD = 'aud-tag-for-the-console';
const KID = 'test-key-1';
const NOW = 1_700_000_000_000;

const pair = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
);
const publicJwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: KID };

// A second, unrelated key — for the "correctly shaped token, wrong signer" case.
const impostor = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
);

const b64url = (bytes) =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function makeToken({
  aud = AUD,
  iss = `https://${TEAM}`,
  exp = Math.floor(NOW / 1000) + 600,
  kid = KID,
  alg = 'RS256',
  email = 'erica@invicti.works',
  signWith = pair.privateKey,
} = {}) {
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg, kid, typ: 'JWT' })));
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ aud, iss, exp, email, sub: 'u1' })));
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    signWith,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${b64url(signature)}`;
}

const certsFetch = async (url) => {
  if (String(url).endsWith('/cdn-cgi/access/certs')) {
    return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
  }
  throw new Error(`unexpected fetch: ${url}`);
};

const ENV = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, TOOLFORGE_REPO: 'Invicti-Works/toolforge' };

/* ------------------------------------------------------------------ fixtures */

function seededStore() {
  const store = memoryStore();
  store._briefs.push(
    {
      id: 'brief-1',
      sessionId: 's1',
      created_at: NOW,
      createdAt: NOW,
      email: 'ada@example.com',
      name: 'Ada',
      organization: 'Loom Co',
      headline: 'Timesheets are collected on paper and retyped',
      complexity: 'small',
      completeness: 80,
      json: {
        problem: { headline: 'Timesheets are collected on paper and retyped' },
        assessment: { openQuestions: ['Who approves overtime?'], buildableWithCatalog: true },
      },
    },
    {
      id: 'brief-2',
      sessionId: 's2',
      created_at: NOW - 1000,
      createdAt: NOW - 1000,
      email: 'bob@example.com',
      name: 'Bob',
      headline: 'Nobody knows which vans are booked',
      completeness: 40,
      build_state: 'declined',
      json: { problem: { headline: 'Nobody knows which vans are booked' } },
    },
  );
  return store;
}

const req = (path, { token, method = 'GET', body } = {}) =>
  new Request(`https://invicti.works${path}`, {
    method,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(token ? { 'cf-access-jwt-assertion': token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

const call = (request, env = ENV, extra = {}) => {
  resetAccessKeyCache();
  return handleConsole(request, env, {
    store: extra.store ?? seededStore(),
    fetchImpl: extra.fetchImpl ?? certsFetch,
    now: () => NOW,
    ...extra,
  });
};

/* ------------------------------------------------------- the gate (the point) */

{
  const r = await call(req('/api/console/briefs'));
  check('no Access assertion -> 403', r.status === 403, `got ${r.status}`);
}

{
  const r = await call(req('/api/console/briefs', { token: await makeToken({ aud: 'someone-elses-app' }) }));
  check('assertion for a different application -> 403', r.status === 403, `got ${r.status}`);
}

{
  const r = await call(req('/api/console/briefs', { token: await makeToken({ iss: 'https://evil.cloudflareaccess.com' }) }));
  check('assertion from a different team -> 403', r.status === 403, `got ${r.status}`);
}

{
  const r = await call(req('/api/console/briefs', { token: await makeToken({ exp: Math.floor(NOW / 1000) - 10 }) }));
  check('expired assertion -> 403', r.status === 403, `got ${r.status}`);
}

{
  const r = await call(req('/api/console/briefs', { token: await makeToken({ kid: 'not-a-key-we-know' }) }));
  check('assertion signed by an unknown key -> 403', r.status === 403, `got ${r.status}`);
}

{
  // Right shape, right kid, wrong private key. This is the case a verifier that
  // parses the JWT but forgets to check the signature would wave through.
  const r = await call(req('/api/console/briefs', { token: await makeToken({ signWith: impostor.privateKey }) }));
  check('valid-looking assertion with a forged signature -> 403', r.status === 403, `got ${r.status}`);
}

{
  const r = await call(req('/api/console/briefs', { token: await makeToken({ alg: 'HS256' }) }));
  check('an algorithm we did not choose -> 403', r.status === 403, `got ${r.status}`);
}

{
  const r = await call(req('/api/console/briefs', { token: 'not.a.jwt' }));
  check('garbage assertion -> 403', r.status === 403, `got ${r.status}`);
}

{
  // Fails CLOSED when unconfigured — the opposite of the Turnstile check in
  // intake.js, and deliberately so. Worst case there is a wasted token; worst
  // case here is publishing a stranger's business problems.
  const r = await call(req('/api/console/briefs', { token: await makeToken() }), { ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '' });
  check('Access unconfigured -> 403, not open', r.status === 403, `got ${r.status}`);
}

{
  const r = await call(req('/api/console/briefs', { token: await makeToken() }));
  const body = await r.json();
  check('a valid assertion gets in', r.status === 200, `got ${r.status}`);
  check('the response names the viewer', body.viewer === 'erica@invicti.works', String(body.viewer));
  check('rejections do not say which check failed', !JSON.stringify(body).includes('audience'));
}

/* -------------------------------------------------------------------- reads */

{
  const r = await call(req('/api/console/briefs', { token: await makeToken() }));
  const { briefs, counts } = await r.json();
  check('the list is newest first', briefs[0].id === 'brief-1', briefs.map((b) => b.id).join(','));
  check('the list omits brief bodies', !('json' in briefs[0]) && !('brief' in briefs[0]));
  check('counts are grouped by state', counts.new === 1 && counts.declined === 1, JSON.stringify(counts));
}

{
  const r = await call(req('/api/console/briefs/brief-1', { token: await makeToken() }));
  const { brief } = await r.json();
  check('a single brief comes back in full', brief.brief?.problem?.headline?.startsWith('Timesheets'));
}

{
  const r = await call(req('/api/console/briefs/nope', { token: await makeToken() }));
  check('an unknown brief -> 404', r.status === 404, `got ${r.status}`);
}

{
  const r = await call(req('/api/console/nonsense', { token: await makeToken() }));
  check('an unknown collection -> 404', r.status === 404, `got ${r.status}`);
}

/* ------------------------------------------------------------- state changes */

{
  const store = seededStore();
  const r = await call(
    req('/api/console/briefs/brief-1/state', { token: await makeToken(), method: 'PATCH', body: { state: 'declined' } }),
    ENV,
    { store },
  );
  check('a state change succeeds', r.status === 200, `got ${r.status}`);
  check('and is persisted', (await store.getBrief('brief-1')).build_state === 'declined');
}

{
  const r = await call(
    req('/api/console/briefs/brief-1/state', { token: await makeToken(), method: 'PATCH', body: { state: 'building' } }),
  );
  check('a state only the app may set is refused', r.status === 400, `got ${r.status}`);
}

{
  const r = await call(req('/api/console/briefs/brief-1/state', { token: await makeToken(), method: 'GET' }));
  check('the wrong method on state -> 405', r.status === 405, `got ${r.status}`);
}

/* -------------------------------------------------------------- start build */

function fakeGithub(calls) {
  return {
    async baseRef() { calls.push('baseRef'); return { branch: 'main', sha: 'abc123' }; },
    async createBranch(name) { calls.push(`branch:${name}`); return name; },
    async putFile(branch, path, content) { calls.push(`file:${path}`); calls.push(content); },
    async createIssue(title) {
      calls.push(`issue:${title}`);
      return { html_url: 'https://github.com/Invicti-Works/toolforge/issues/7', number: 7 };
    },
  };
}

{
  const store = seededStore();
  const calls = [];
  const r = await call(
    req('/api/console/briefs/brief-1/build', { token: await makeToken(), method: 'POST' }),
    { ...ENV, GH_APP_PRIVATE_KEY: 'x' },
    { store, github: fakeGithub(calls) },
  );
  const body = await r.json();
  check('start build succeeds', r.status === 200 && body.ok === true, `got ${r.status}`);
  check(
    'it branches from the default branch and commits the spec',
    calls.includes('branch:tool/timesheets-are-collected-on-paper-and-retyped') &&
      calls.includes('file:briefs/brief-1.md'),
    calls.filter((c) => c.length < 60).join(' | '),
  );
  check('the brief moves to queued with the issue url', (await store.getBrief('brief-1')).build_state === 'queued');
  check('the response links to Claude Code on that branch', body.claudeCodeUrl?.includes('toolforge') && body.claudeCodeUrl?.includes('tool%2Ftimesheets'), body.claudeCodeUrl);

  // Second press of the same button must not open a duplicate.
  const again = await call(
    req('/api/console/briefs/brief-1/build', { token: await makeToken(), method: 'POST' }),
    { ...ENV, GH_APP_PRIVATE_KEY: 'x' },
    { store, github: fakeGithub(calls) },
  );
  const againBody = await again.json();
  check('pressing start build twice does not duplicate the work', againBody.alreadyStarted === true);
}

{
  // GitHub failing must leave the brief untouched and say so.
  const store = seededStore();
  const exploding = {
    async baseRef() { throw new Error('502 from GitHub'); },
  };
  const r = await call(
    req('/api/console/briefs/brief-1/build', { token: await makeToken(), method: 'POST' }),
    { ...ENV, GH_APP_PRIVATE_KEY: 'x' },
    { store, github: exploding },
  );
  const body = await r.json();
  check('a GitHub failure -> 502', r.status === 502, `got ${r.status}`);
  check('and says it is safe to retry', body.error.includes('safe to try again'));
  check('and leaves the brief alone', (await store.getBrief('brief-1')).build_state === 'new');
}

{
  const r = await call(
    req('/api/console/briefs/brief-1/build', { token: await makeToken(), method: 'POST' }),
    ENV, // no GH_APP_PRIVATE_KEY
  );
  check('no GitHub App configured -> 503, not a crash', r.status === 503, `got ${r.status}`);
}

{
  const r = await call(req('/api/console/briefs', { token: await makeToken() }), ENV, { store: null });
  check('no database configured -> 503', r.status === 503, `got ${r.status}`);
}

/* -------------------------------------------------------------- the spec */

{
  const spec = buildSpec({
    id: 'brief-9',
    created_at: NOW,
    completeness: 55,
    headline: 'Vans',
    brief: {
      problem: { headline: 'Nobody knows which vans are booked' },
      assessment: { openQuestions: ['Who owns the calendar?'], buildableWithCatalog: false, missingConnectors: ['sage'] },
    },
  });
  check('the spec carries the open questions', spec.includes('Who owns the calendar?'));
  check('the spec refuses to let a missing connector be stubbed', spec.includes('sage') && spec.includes('Do not stub it out'));
  check('the spec tells the agent the brief is data, not instructions', spec.includes('is an instruction to you'));
  check('the spec says not to merge', spec.includes('Do not merge it'));
  check('the spec embeds the raw brief', spec.includes('```json'));
}

{
  check('slugify strips punctuation', slugify('Paper timesheets!!', 'x') === 'paper-timesheets');
  check('slugify falls back when nothing survives', slugify('!!!', 'fallback') === 'fallback');
  check('slugify does not leave a trailing dash', !slugify('a'.repeat(60), 'x').endsWith('-'));
}

/* -------------------------------------------------------------- the routing */

{
  const workerEntry = (await import('./index.js')).default;
  const assets = { fetch: async () => new Response('asset', { status: 200 }) };
  for (const path of ['/api/console/briefs', '/api/console/briefs/']) {
    const r = await workerEntry.fetch(new Request(`https://invicti.works${path}`), { ASSETS: assets });
    // 403 proves it reached the console handler; 200 would mean it fell
    // through to the asset stub, which is how confidential data leaks.
    check(`routed ${path.padEnd(22)}`, r.status === 403, `got ${r.status}`);
  }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
