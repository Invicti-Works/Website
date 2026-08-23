/**
 * POST /api/contact — the "Find your solution" form handler.
 *
 * Accepts either JSON (the enhanced path) or a normal form POST (the no-JS
 * path) and emails the message on via Resend. Replies in kind: JSON to a fetch,
 * a rendered HTML confirmation to a browser that submitted the form directly.
 *
 * The request/response and email helpers live in worker/lib/ because
 * /api/intake needs the same ones; see worker/lib/http.js for why the dual-mode
 * reply matters.
 *
 * Configuration, all set on the Worker (see docs/SETUP.md step 6):
 *   RESEND_API_KEY   required. Without it this returns 503 and the browser
 *                    falls back to mailto, so no message is lost.
 *   CONTACT_TO       optional. Defaults to info@invicti.works.
 *   CONTACT_FROM     optional. Defaults to website@invicti.works, which must be
 *                    a domain verified in Resend.
 */
import { htmlPage, json, looksLikeEmail, readSubmission, wantsJson } from './lib/http.js';
import { DEFAULT_TO, sendEmail } from './lib/email.js';

/** This form's own limits, unchanged: the intake route is allowed a larger body. */
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

export async function handleContact(request, env) {
  const asJson = wantsJson(request);

  if (request.method !== 'POST') {
    return asJson
      ? json({ error: 'Method not allowed.' }, 405)
      : htmlPage('Method not allowed', 'This address only accepts form submissions.', 405);
  }

  const data = await readSubmission(request, MAX_BODY_BYTES);
  if (!data) {
    return asJson
      ? json({ error: 'We could not read that submission.' }, 400)
      : htmlPage('Something went wrong', 'We could not read that submission.', 400);
  }

  // Honeypot: a real visitor never sees this field. Answer 200 rather than an
  // error so the bot records a success and does not retry.
  if (typeof data.companyUrl === 'string' && data.companyUrl.trim() !== '') {
    return asJson ? json({ ok: true }, 200) : htmlPage('Thank you', 'Your message has been sent.', 200);
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

  const lines = [
    `Name: ${name}`,
    `Email: ${email}`,
    organization ? `Organization: ${organization}` : null,
    `Needs: ${NEED_LABELS[need] ?? (need || 'Not specified')}`,
    timeline ? `Timeline: ${TIMELINE_LABELS[timeline] ?? timeline}` : null,
    '',
    message,
  ].filter(Boolean);

  const sent = await sendEmail(env, {
    replyTo: email,
    subject: `Website message — ${name}${organization ? ` (${organization})` : ''}`,
    text: lines.join('\n'),
  });

  // No key configured yet. 503 rather than 500: the client script reads any
  // non-400 as "not the visitor's fault" and falls back to mailto.
  if (!sent.ok && sent.reason === 'notConfigured') {
    return asJson
      ? json({ error: 'Message delivery is not configured yet.' }, 503)
      : htmlPage(
          'Please email us directly',
          `Our contact form is not finished being set up. Please email ${env.CONTACT_TO ?? DEFAULT_TO}.`,
          503,
        );
  }

  if (!sent.ok) {
    return asJson
      ? json({ error: 'We could not send that just now.' }, 502)
      : htmlPage(
          'Please email us directly',
          `We could not send that just now. Please email ${env.CONTACT_TO ?? DEFAULT_TO}.`,
          502,
        );
  }

  return asJson
    ? json({ ok: true }, 200)
    : htmlPage('Thank you', 'We have got your message and will come back to you shortly.', 200);
}
