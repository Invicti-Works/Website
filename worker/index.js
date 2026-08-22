/**
 * Worker entry point.
 *
 * The site is static: Cloudflare serves everything in `dist/` from the asset
 * layer without ever invoking this script, so ordinary page views stay on the
 * free, unmetered asset tier. This runs only for the two OAuth paths listed
 * under `run_worker_first` in wrangler.jsonc, plus any request that matches no
 * asset at all.
 *
 * It does two things: signs editors in to the CMS at /admin/ (the OAuth flow is
 * vendored from sveltia-cms-auth; see worker/cms-auth.js), and receives the
 * "Find your solution" enquiry form (see worker/enquiry.js).
 */
import cmsAuth from './cms-auth.js';
import { handleEnquiry } from './enquiry.js';

/** Paths the vendored handler owns. Everything else falls through to assets. */
const AUTH_PATHS = new Set(['/oauth/authorize', '/oauth/redirect']);

const ENQUIRY_PATH = '/api/enquiry';

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    // Match `/oauth/authorize` and `/oauth/authorize/` alike. The asset layer's
    // `auto-trailing-slash` handling means either form can reach us, and an
    // unmatched OAuth path would fall through to the 404 page inside the
    // sign-in popup -- which looks like sign-in doing nothing at all.
    const route = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;

    if (AUTH_PATHS.has(route)) {
      return cmsAuth.fetch(request, env, ctx);
    }

    if (route === ENQUIRY_PATH) {
      return handleEnquiry(request, env);
    }

    // Not an OAuth path, and the asset layer already found no file for it.
    // Handing it back to the assets binding yields the built 404 page with a
    // real 404 status, rather than the bare response a Worker would return.
    return env.ASSETS.fetch(request);
  },
};
