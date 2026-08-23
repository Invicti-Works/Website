/**
 * Cloudflare Access: verifying that a request really came through the gate.
 *
 * Access sits in front of /console and /api/console at the edge, so in the
 * normal case nothing unauthenticated reaches the Worker at all. This module
 * checks anyway, and that is the point: the pages behind it show other
 * people's confidential business briefs, and the thing standing between those
 * and the open internet should not be a single dashboard toggle that somebody
 * can turn off by accident. If the Access application is ever misconfigured,
 * deleted, or scoped to the wrong path, these checks are what stops the API
 * answering.
 *
 * FAILS CLOSED, unlike the Turnstile check in worker/intake.js. That one lets
 * requests through when it is unconfigured, because the worst case is a bot
 * wasting a few tokens. Here the worst case is publishing a stranger's business
 * problems, so an unconfigured verifier rejects everything -- a console that
 * does not work yet is a much better failure than one that works for everyone.
 *
 * Configuration (plain vars, both public identifiers):
 *   ACCESS_TEAM_DOMAIN   e.g. invicti.cloudflareaccess.com
 *   ACCESS_AUD           the Access application's Audience tag
 */

const JWT_HEADER = 'cf-access-jwt-assertion';

/**
 * Cached signing keys, in module scope so they survive between requests on a
 * warm isolate. Cloudflare rotates these, so the TTL is short enough to pick a
 * rotation up without asking on every request.
 */
const KEY_CACHE_MS = 60 * 60 * 1000;
let keyCache = { domain: null, keys: null, fetchedAt: 0 };

const b64urlToBytes = (value) => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};

const b64urlToString = (value) => new TextDecoder().decode(b64urlToBytes(value));

async function fetchKeys(teamDomain, now, fetchImpl) {
  if (keyCache.domain === teamDomain && keyCache.keys && now - keyCache.fetchedAt < KEY_CACHE_MS) {
    return keyCache.keys;
  }

  const response = await fetchImpl(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`Access certs returned ${response.status}`);

  const { keys } = await response.json();
  if (!Array.isArray(keys) || keys.length === 0) throw new Error('Access certs returned no keys');

  keyCache = { domain: teamDomain, keys, fetchedAt: now };
  return keys;
}

/**
 * Verify the `Cf-Access-Jwt-Assertion` header.
 *
 * @returns {Promise<{ok: true, email: string, sub: string} | {ok: false, reason: string}>}
 */
export async function verifyAccess(request, env, deps = {}) {
  const now = (deps.now ?? Date.now)();
  const fetchImpl = deps.fetchImpl ?? fetch;

  const teamDomain = env.ACCESS_TEAM_DOMAIN;
  const audience = env.ACCESS_AUD;
  if (!teamDomain || !audience) {
    // See the note at the top: unconfigured means closed, not open.
    return { ok: false, reason: 'Access is not configured on this Worker.' };
  }

  const token = request.headers.get(JWT_HEADER);
  if (!token) return { ok: false, reason: 'No Access assertion on the request.' };

  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'Malformed Access assertion.' };

  let header;
  let payload;
  try {
    header = JSON.parse(b64urlToString(parts[0]));
    payload = JSON.parse(b64urlToString(parts[1]));
  } catch {
    return { ok: false, reason: 'Unreadable Access assertion.' };
  }

  if (header.alg !== 'RS256') {
    // Refuse to be told which algorithm to trust. `alg: none` and
    // algorithm-confusion attacks both start with taking this field seriously.
    return { ok: false, reason: 'Unexpected signing algorithm.' };
  }

  // Check the cheap claims before doing any crypto or network work.
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(audience)) {
    return { ok: false, reason: 'Assertion is for a different application.' };
  }
  if (payload.iss !== `https://${teamDomain}`) {
    return { ok: false, reason: 'Assertion is from a different team.' };
  }

  const seconds = Math.floor(now / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= seconds) {
    return { ok: false, reason: 'Assertion has expired.' };
  }
  if (typeof payload.nbf === 'number' && payload.nbf > seconds + 60) {
    return { ok: false, reason: 'Assertion is not valid yet.' };
  }

  let keys;
  try {
    keys = await fetchKeys(teamDomain, now, fetchImpl);
  } catch (error) {
    console.error('access: could not fetch signing keys', error?.message ?? 'unknown');
    return { ok: false, reason: 'Could not verify the assertion.' };
  }

  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return { ok: false, reason: 'Assertion signed by an unknown key.' };

  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = b64urlToBytes(parts[2]);

  let valid = false;
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signed);
  } catch (error) {
    console.error('access: verification threw', error?.name ?? 'unknown');
    return { ok: false, reason: 'Could not verify the assertion.' };
  }

  if (!valid) return { ok: false, reason: 'Assertion signature does not check out.' };

  return { ok: true, email: payload.email ?? null, sub: payload.sub ?? null };
}

/** Test seam: drop the cached keys so a test can control what is fetched. */
export function resetAccessKeyCache() {
  keyCache = { domain: null, keys: null, fetchedAt: 0 };
}
