/**
 * Worker entry point.
 *
 * The site is static: Cloudflare serves everything in `dist/` from the asset
 * layer without ever invoking this script, so ordinary page views stay on the
 * free, unmetered asset tier. This runs only for the two OAuth paths listed
 * under `run_worker_first` in wrangler.jsonc, plus any request that matches no
 * asset at all.
 *
 * It does four things: signs editors in to the CMS at /admin/ (the OAuth flow
 * is vendored from sveltia-cms-auth; see worker/cms-auth.js), receives the
 * "Find your solution" contact form (see worker/contact.js), runs the AI intake
 * conversation behind /build (see worker/intake.js), and serves the founders'
 * console behind Cloudflare Access (see worker/console.js).
 */
import cmsAuth from './cms-auth.js';
import { handleContact } from './contact.js';
import { handleIntake } from './intake.js';
import { handleConsole } from './console.js';

/** Paths the vendored handler owns. Everything else falls through to assets. */
const AUTH_PATHS = new Set(['/oauth/authorize', '/oauth/redirect']);

/**
 * Rebuild a request with `pathname` replaced, preserving method, headers, body
 * and query string. Returns the original untouched when nothing changed, so the
 * common case allocates nothing.
 */
const normalize = (request, pathname) => {
  const url = new URL(request.url);

  if (url.pathname === pathname) {
    return request;
  }

  url.pathname = pathname;

  return new Request(url, request);
};

const CONTACT_PATH = '/api/contact';
const INTAKE_PATH = '/api/intake';

/**
 * A prefix rather than a fixed path: the console addresses individual briefs
 * and actions on them. Everything under it is gated by Cloudflare Access at
 * the edge AND re-checked in worker/lib/access.js, so a path that slips past
 * one of those two still meets the other.
 */
const CONSOLE_PREFIX = '/api/console/';

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    // Match `/oauth/authorize` and `/oauth/authorize/` alike. The asset layer's
    // `auto-trailing-slash` handling means either form can reach us, and an
    // unmatched OAuth path would fall through to the 404 page inside the
    // sign-in popup -- which looks like sign-in doing nothing at all.
    const route = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;

    if (AUTH_PATHS.has(route)) {
      // Hand over a request whose URL carries the normalised path, not just the
      // normalised string. cms-auth.js re-parses the URL off the request it is
      // given and matches the path exactly, so passing the original through
      // would have it fall to its own `404` with an empty body -- a blank page
      // in the sign-in popup, which is precisely the symptom this is meant to
      // rule out. Normalising only for the branch decision fixed nothing.
      return cmsAuth.fetch(normalize(request, route), env, ctx);
    }

    if (route === CONTACT_PATH) {
      return handleContact(request, env);
    }

    if (route === INTAKE_PATH) {
      return handleIntake(request, env);
    }

    // Compare against the un-normalised path: a trailing slash is meaningful
    // here (`/api/console/briefs/` is the list) and stripping it first would
    // make `/api/console` alone match the prefix.
    if (pathname.startsWith(CONSOLE_PREFIX)) {
      return handleConsole(request, env);
    }

    // Not an OAuth path, and the asset layer already found no file for it.
    // Handing it back to the assets binding yields the built 404 page with a
    // real 404 status, rather than the bare response a Worker would return.
    return env.ASSETS.fetch(request);
  },
};
