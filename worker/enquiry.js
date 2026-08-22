/**
 * POST /api/enquiry — the "Find your solution" form handler.
 *
 * Accepts either JSON (the enhanced path) or a normal form POST (the no-JS
 * path) and emails the enquiry on via Resend. Replies in kind: JSON to a fetch,
 * a rendered HTML confirmation to a browser that submitted the form directly.
 *
 * Configuration, all set on the Worker (see docs/SETUP.md step 6):
 *   RESEND_API_KEY   required. Without it this returns 503 and the browser
 *                    falls back to mailto, so no enquiry is lost.
 *   ENQUIRY_TO       optional. Defaults to info@invicti.works.
 *   ENQUIRY_FROM     optional. Defaults to website@invicti.works, which must be
 *                    a domain verified in Resend.
 */

const DEFAULT_TO = 'info@invicti.works';
const DEFAULT_FROM = 'Invicti.Works website <website@invicti.works>';

/** Refuse oversized bodies before parsing rather than after. */
const MAX_BODY_BYTES = 16 * 1024;
const MAX_MESSAGE_CHARS = 5000;

const NEED_LABELS = {
  mobile: 'A mobile app',
  web: 'A web platform',
  both: 'Both — an app and the platform behind it',
  existing: 'Help with something already built',
  unsure: 'Not sure yet',
};

const TIMELINE_LABELS = {
  exploring: 'Just exploring',
  '3months': 'Within 3 months',
  '6months': 'Within 6 months',
  live: 'Already have a deadline',
};

/**
 * Deliberately permissive. Strict email regexes reject valid addresses far more
 * often than they catch bad ones, and the real check is whether the reply
 * arrives.
 */
const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

const wantsJson = (request) =>
  (request.headers.get('accept') ?? '').includes('application/json') ||
  (request.headers.get('content-type') ?? '').includes('application/json');

const json = (body, status) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

/** Minimal styled page for the no-JavaScript path. */
const htmlPage = (title, message, status) =>
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

async function readSubmission(request) {
  const type = request.headers.get('content-type') ?? '';
  const raw = await request.text();

  if (raw.length > MAX_BODY_BYTES) return null;

  if (type.includes('application/json')) {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  return Object.fromEntries(new URLSearchParams(raw).entries());
}

export async function handleEnquiry(request, env) {
  const asJson = wantsJson(request);

  if (request.method !== 'POST') {
    return asJson
      ? json({ error: 'Method not allowed.' }, 405)
      : htmlPage('Method not allowed', 'This address only accepts form submissions.', 405);
  }

  const data = await readSubmission(request);
  if (!data) {
    return asJson
      ? json({ error: 'We could not read that submission.' }, 400)
      : htmlPage('Something went wrong', 'We could not read that submission.', 400);
  }

  // Honeypot: a real visitor never sees this field. Answer 200 rather than an
  // error so the bot records a success and does not retry.
  if (typeof data.companyUrl === 'string' && data.companyUrl.trim() !== '') {
    return asJson ? json({ ok: true }, 200) : htmlPage('Thank you', 'Your enquiry has been sent.', 200);
  }

  const name = String(data.name ?? '').trim();
  const email = String(data.email ?? '').trim();
  const message = String(data.message ?? '').trim();
  const organization = String(data.organization ?? '').trim();
  const need = String(data.need ?? '').trim();
  const timeline = String(data.timeline ?? '').trim();

  if (!name || !email || !message) {
    const error = 'Please give your name, your email and a short description.';
    return asJson ? json({ error }, 400) : htmlPage('Almost there', error, 400);
  }

  if (!looksLikeEmail(email)) {
    const error = 'That email address does not look right.';
    return asJson ? json({ error }, 400) : htmlPage('Almost there', error, 400);
  }

  if (message.length > MAX_MESSAGE_CHARS) {
    const error = 'That message is too long — please keep it under 5000 characters.';
    return asJson ? json({ error }, 400) : htmlPage('Almost there', error, 400);
  }

  // No key configured yet. 503 rather than 500: the client script reads any
  // non-400 as "not the visitor's fault" and falls back to mailto.
  if (!env.RESEND_API_KEY) {
    return asJson
      ? json({ error: 'Enquiry delivery is not configured yet.' }, 503)
      : htmlPage(
          'Please email us directly',
          `Our enquiry form is not finished being set up. Please email ${env.ENQUIRY_TO ?? DEFAULT_TO}.`,
          503,
        );
  }

  const lines = [
    `Name: ${name}`,
    `Email: ${email}`,
    organization ? `Organization: ${organization}` : null,
    `Needs: ${NEED_LABELS[need] ?? (need || 'Not specified')}`,
    timeline ? `Timeline: ${TIMELINE_LABELS[timeline] ?? timeline}` : null,
    '',
    message,
  ].filter(Boolean);

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: env.ENQUIRY_FROM ?? DEFAULT_FROM,
      to: [env.ENQUIRY_TO ?? DEFAULT_TO],
      // So hitting reply in the inbox writes to the enquirer, not to us.
      reply_to: email,
      subject: `Website enquiry — ${name}${organization ? ` (${organization})` : ''}`,
      text: lines.join('\n'),
    }),
  });

  if (!response.ok) {
    // Never surface the provider's response body: it can carry key state and
    // account detail. The status is enough to debug from the Worker logs.
    console.error('Resend rejected the enquiry', response.status);
    return asJson
      ? json({ error: 'We could not send that just now.' }, 502)
      : htmlPage(
          'Please email us directly',
          `We could not send that just now. Please email ${env.ENQUIRY_TO ?? DEFAULT_TO}.`,
          502,
        );
  }

  return asJson
    ? json({ ok: true }, 200)
    : htmlPage('Thank you', 'We have got your enquiry and will come back to you shortly.', 200);
}
