/**
 * The GitHub App that opens build work in the private toolforge repo.
 *
 * A GitHub App rather than a personal access token or the CMS's OAuth app,
 * for three reasons: it is scoped to one repository rather than to everything
 * a human can reach, it is revocable without touching anyone's personal
 * account, and it leaves an audit trail attributed to the app rather than to
 * whoever happened to generate a token. The CMS app in worker/cms-auth.js is a
 * different thing entirely -- a user-facing OAuth app for editing content in
 * the public website repo.
 *
 * Configuration:
 *   GH_APP_ID                plain var. An identifier, not a secret.
 *   GH_APP_INSTALLATION_ID   plain var. Likewise.
 *   GH_APP_PRIVATE_KEY       ENCRYPTED SECRET. A PKCS#8 PEM. This one is the
 *                            keys to the org, so it never goes in
 *                            wrangler.jsonc -- there is a test asserting that.
 *   TOOLFORGE_REPO           plain var, "Owner/name".
 *
 * GitHub hands out PKCS#1 ("BEGIN RSA PRIVATE KEY") by default and WebCrypto
 * only reads PKCS#8, so the key has to be converted once when it is set up:
 *   openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in app.pem
 * The error message below says so, because otherwise this fails with an opaque
 * DataError months after anyone remembers the format mattered.
 */

const API = 'https://api.github.com';
const UA = 'invicti-works-console';

/**
 * Installation tokens last an hour. Cached in module scope so a warm isolate
 * reuses one instead of signing a fresh JWT per request, and expired a minute
 * early so a token cannot die mid-request.
 */
let tokenCache = { token: null, expiresAt: 0 };

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

function pemToPkcs8(pem) {
  const body = pem
    .replace(/-----BEGIN [A-Z ]+-----/, '')
    .replace(/-----END [A-Z ]+-----/, '')
    .replace(/\s+/g, '');
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

/** A short-lived JWT proving we hold the app's private key. */
async function appJwt(env, now) {
  const pem = env.GH_APP_PRIVATE_KEY;
  if (!pem) throw new Error('GH_APP_PRIVATE_KEY is not set');

  if (pem.includes('BEGIN RSA PRIVATE KEY')) {
    throw new Error(
      'GH_APP_PRIVATE_KEY is PKCS#1; convert it with `openssl pkcs8 -topk8 -nocrypt` (docs/SETUP.md 13c)',
    );
  }

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(pem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const seconds = Math.floor(now / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = b64url(
    new TextEncoder().encode(
      // 60s back-dated: GitHub rejects a JWT whose iat is in its future, and
      // small clock differences between edge locations are routine.
      JSON.stringify({ iat: seconds - 60, exp: seconds + 540, iss: env.GH_APP_ID }),
    ),
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );

  return `${header}.${payload}.${b64url(signature)}`;
}

async function installationToken(env, now, fetchImpl) {
  if (tokenCache.token && tokenCache.expiresAt > now + 60_000) return tokenCache.token;

  const jwt = await appJwt(env, now);
  const response = await fetchImpl(
    `${API}/app/installations/${env.GH_APP_INSTALLATION_ID}/access_tokens`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${jwt}`,
        accept: 'application/vnd.github+json',
        'user-agent': UA,
      },
    },
  );

  if (!response.ok) {
    // Never echo the body: it can carry installation detail and, on some
    // errors, fragments of what was sent.
    throw new Error(`GitHub refused the installation token (${response.status})`);
  }

  const { token, expires_at: expiresAt } = await response.json();
  tokenCache = { token, expiresAt: Date.parse(expiresAt) };
  return token;
}

/**
 * A thin authenticated client. Every method returns parsed JSON and throws a
 * message safe to show a signed-in founder -- status codes, never bodies.
 */
export function githubApp(env, deps = {}) {
  const now = deps.now ?? Date.now;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const repo = env.TOOLFORGE_REPO;

  async function call(path, init = {}) {
    const token = await installationToken(env, now(), fetchImpl);
    const response = await fetchImpl(`${API}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'user-agent': UA,
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      console.error('github: request failed', path, response.status);
      const error = new Error(`GitHub returned ${response.status} for ${path}`);
      error.status = response.status;
      throw error;
    }

    return response.status === 204 ? null : response.json();
  }

  return {
    /** The repo's default branch and the SHA at its tip. */
    async baseRef() {
      const info = await call(`/repos/${repo}`);
      const ref = await call(`/repos/${repo}/git/ref/heads/${info.default_branch}`);
      return { branch: info.default_branch, sha: ref.object.sha };
    },

    /** Create a branch. Treats "already exists" as success — this is re-runnable. */
    async createBranch(name, fromSha) {
      try {
        await call(`/repos/${repo}/git/refs`, {
          method: 'POST',
          body: JSON.stringify({ ref: `refs/heads/${name}`, sha: fromSha }),
        });
      } catch (error) {
        if (error.status !== 422) throw error;
      }
      return name;
    },

    /** Commit one file. `content` is plain text; GitHub wants it base64. */
    async putFile(branch, path, content, message) {
      // The whole spec is ASCII-safe only by luck, so encode as UTF-8 first --
      // btoa on a string with an em dash in it throws.
      const bytes = new TextEncoder().encode(content);
      const encoded = btoa(String.fromCharCode(...bytes));
      return call(`/repos/${repo}/contents/${path}`, {
        method: 'PUT',
        body: JSON.stringify({ message, content: encoded, branch }),
      });
    },

    async createIssue(title, body, labels = []) {
      return call(`/repos/${repo}/issues`, {
        method: 'POST',
        body: JSON.stringify({ title, body, labels }),
      });
    },

    async getIssue(number) {
      return call(`/repos/${repo}/issues/${number}`);
    },

    /** Kick the Claude Code workflow for an unattended pass. */
    async dispatchWorkflow(workflow, ref, inputs) {
      return call(`/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
        method: 'POST',
        body: JSON.stringify({ ref, inputs }),
      });
    },
  };
}

/** Test seam: drop the cached installation token. */
export function resetGithubTokenCache() {
  tokenCache = { token: null, expiresAt: 0 };
}
