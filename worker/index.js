/**
 * Worker entry point.
 *
 * The site is static: Cloudflare serves everything in `dist/` from the asset
 * layer without ever invoking this script, so ordinary page views stay on the
 * free, unmetered asset tier. This runs only for the two OAuth paths listed
 * under `run_worker_first` in wrangler.jsonc, plus any request that matches no
 * asset at all.
 *
 * Its whole job is signing editors in to the CMS at /admin/. The OAuth flow
 * itself is vendored from sveltia-cms-auth; see worker/cms-auth.js.
 */
import cmsAuth from './cms-auth.js';

/** Paths the vendored handler owns. Everything else falls through to assets. */
const AUTH_PATHS = new Set(['/oauth/authorize', '/oauth/redirect']);

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    if (AUTH_PATHS.has(pathname)) {
      return cmsAuth.fetch(request, env, ctx);
    }

    // Not an OAuth path, and the asset layer already found no file for it.
    // Handing it back to the assets binding yields the built 404 page with a
    // real 404 status, rather than the bare response a Worker would return.
    return env.ASSETS.fetch(request);
  },
};
