/**
 * Outbound email, via Resend.
 *
 * Extracted from worker/contact.js so /api/intake sends briefs through exactly
 * the same path the contact form has been proving in production.
 *
 * Two behaviours here are deliberate and load-bearing:
 *
 *  - The provider's response body is never returned to a caller and never
 *    logged in full. It can carry key state and account detail; the status is
 *    enough to debug from the Worker logs.
 *  - A missing RESEND_API_KEY is reported as `notConfigured`, not as a failure.
 *    Callers turn that into a 503 rather than a 500, because the browser reads
 *    any non-400 as "not the visitor's fault" and falls back to mailto.
 */

export const DEFAULT_TO = 'info@invicti.works';
export const DEFAULT_FROM = 'Invicti.Works website <website@invicti.works>';

/**
 * @returns {Promise<{ok: true} | {ok: false, reason: 'notConfigured'|'rejected', status?: number}>}
 */
export async function sendEmail(env, { to, from, replyTo, subject, text }, fetchImpl = fetch) {
  if (!env.RESEND_API_KEY) {
    return { ok: false, reason: 'notConfigured' };
  }

  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: from ?? env.CONTACT_FROM ?? DEFAULT_FROM,
      to: [to ?? env.CONTACT_TO ?? DEFAULT_TO],
      // So hitting reply in the inbox writes to the enquirer, not to us.
      ...(replyTo ? { reply_to: replyTo } : {}),
      subject,
      text,
    }),
  });

  if (!response.ok) {
    console.error('Resend rejected the message', response.status);
    return { ok: false, reason: 'rejected', status: response.status };
  }

  return { ok: true };
}
