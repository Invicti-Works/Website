/**
 * Request and response helpers shared by the Worker's API routes.
 *
 * These started life inside worker/contact.js. They moved out when /api/intake
 * needed the same behaviour: a handler that answers a `fetch` with JSON and a
 * plain browser form POST with a real HTML page, from the same code path. That
 * dual-mode reply is what makes the no-JavaScript path work, so it belongs in
 * one place rather than being reimplemented per route.
 */

/** Refuse oversized bodies before parsing rather than after. */
export const MAX_BODY_BYTES = 32 * 1024;

export const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

/**
 * Deliberately permissive. Strict email regexes reject valid addresses far more
 * often than they catch bad ones, and the real check is whether the reply
 * arrives.
 */
export const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export const wantsJson = (request) =>
  (request.headers.get('accept') ?? '').includes('application/json') ||
  (request.headers.get('content-type') ?? '').includes('application/json');

export const json = (body, status) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

/** Minimal styled page for the no-JavaScript path. */
export const htmlPage = (title, message, status) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — Invicti.Works</title>
<style>
  body{font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
       margin:0;min-height:100vh;display:grid;place-items:center;padding:2rem;
       background:#f4f6f9;color:#12161d}
  main{max-width:34rem;text-align:center;background:#fff;padding:2.5rem;
       border:1px solid #d0d8e2;border-radius:.5rem}
  h1{color:#003870;margin:0 0 .75rem;font-size:1.75rem}
  a{color:#003870;font-weight:600}
</style></head><body><main>
<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>
<p><a href="/">Back to Invicti.Works</a></p>
</main></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );

/**
 * Read a POST body as an object, whether it arrived as JSON or as an ordinary
 * form submission. Returns null for anything unreadable or oversized, which
 * every caller turns into a 400.
 *
 * A key that appears more than once comes back as an array. That is how a
 * browser posts a group of checkboxes sharing one name -- the pills on /build
 * -- and `Object.fromEntries` would have kept only the last one, silently
 * throwing away every answer but the final tick. A key that appears once is
 * still a plain string, so callers reading single fields are unaffected.
 */
export async function readSubmission(request, maxBytes = MAX_BODY_BYTES) {
  const type = request.headers.get('content-type') ?? '';
  const raw = await request.text();

  if (raw.length > maxBytes) return null;

  if (type.includes('application/json')) {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  const params = new URLSearchParams(raw);
  const data = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    data[key] = values.length > 1 ? values : values[0];
  }
  return data;
}
