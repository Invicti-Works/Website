/**
 * POST /api/intake — the AI intake conversation behind /build.
 *
 * Answers a `fetch` with JSON and an ordinary form POST with a real HTML page,
 * the same dual-mode contract worker/contact.js has been proving in production.
 * See worker/lib/http.js.
 *
 * Three paths, in descending order of how good the brief comes out:
 *
 *   1. JSON, turn by turn      the conversation. One model call per turn, which
 *                              both asks the next question and rewrites the
 *                              brief, so the summary can never disagree with
 *                              what was said.
 *   2. form-encoded            no JavaScript, or the visitor preferred a form.
 *                              One structuring pass over eleven answers. If
 *                              that call fails the answers are still stored and
 *                              emailed verbatim -- nothing on this path depends
 *                              on the model succeeding.
 *   3. any non-400 reply       the page falls back to a prefilled mailto. This
 *                              is what makes the route safe to ship before
 *                              ANTHROPIC_API_KEY exists.
 *
 * Configuration (see docs/SETUP.md):
 *   ANTHROPIC_API_KEY         secret. Absent -> 503, never 500.
 *   TURNSTILE_SECRET_KEY      secret. Absent -> the Turnstile check is skipped,
 *                             so the route still works before it is set up.
 *   INTAKE_SALT               secret. Absent -> no per-IP counting, and no IP
 *                             is stored at all. Fails open, quietly, but the
 *                             daily fuse still holds.
 *   INTAKE_MODEL / INTAKE_EFFORT / INTAKE_MAX_TURNS / INTAKE_DAILY_BUDGET_CENTS
 *   BRIEF_TO / BRIEF_FROM     optional; fall back to CONTACT_TO / CONTACT_FROM.
 */
import { htmlPage, json, looksLikeEmail, readSubmission, wantsJson } from './lib/http.js';
import { DEFAULT_TO, sendEmail as defaultSendEmail } from './lib/email.js';
import { BRIEF_VERSION, FORM_FIELDS, validateBrief } from './brief-schema.js';
import {
  DEFAULT_MODEL,
  FORM_STRUCTURING_PROMPT,
  SYSTEM_PROMPT,
  UPDATE_BRIEF_TOOL,
  estimateCents,
} from './intake-prompt.js';
import { d1Store, dayKey } from './intake-store.js';

const MAX_BODY_BYTES = 32 * 1024;
const MAX_MESSAGE_CHARS = 1200;
/** A hard ceiling per conversation, independent of the turn count. */
const MAX_SESSION_INPUT_TOKENS = 60_000;
const MAX_OUTPUT_TOKENS = 1000;
const MAX_NEW_SESSIONS_PER_IP_PER_DAY = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

const num = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/* -------------------------------------------------------------------- utils */

/**
 * Salted hash of the caller's IP, for counting only. The raw address is never
 * stored: a table of visitor IPs is a liability we have no use for. With no
 * salt configured we return null and skip counting rather than storing
 * something weakly hashed.
 */
async function hashIp(request, salt) {
  const ip = request.headers.get('cf-connecting-ip');
  if (!ip || !salt) return null;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(salt),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ip));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verify a Turnstile token. Absent secret means Turnstile is not set up yet, so
 * we allow the request through -- the honeypot, the per-IP count and the daily
 * fuse are all still in force, and failing closed here would take the whole
 * feature down for a missing optional key.
 */
async function turnstileOk(env, token, request, fetchImpl) {
  if (!env.TURNSTILE_SECRET_KEY) return true;
  if (!token) return false;

  const body = new FormData();
  body.append('secret', env.TURNSTILE_SECRET_KEY);
  body.append('response', token);
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) body.append('remoteip', ip);

  try {
    const response = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
    });
    const result = await response.json();
    return result.success === true;
  } catch {
    // A Cloudflare outage should not silently let everything through, but it
    // should not black-hole real visitors either. 403 sends them to the form.
    return false;
  }
}

/** Blank brief: every key present, nothing claimed. */
export function emptyBrief(source = 'conversation') {
  return {
    briefVersion: BRIEF_VERSION,
    source,
    contact: null,
    problem: null,
    users: null,
    platform: null,
    systems: null,
    data: null,
    workflow: null,
    integrations: [],
    constraints: null,
    assessment: null,
    completeness: null,
    consent: null,
  };
}

/* ------------------------------------------------------------ brief -> text */

const bullet = (label, value) => (value == null || value === '' ? null : `  ${label}: ${value}`);
const list = (values) => (Array.isArray(values) && values.length ? values.join('; ') : null);

/** Human-readable summary for the email. The raw JSON follows it. */
export function briefToText(brief) {
  const b = brief ?? {};
  const lines = [];
  const push = (...items) => lines.push(...items.filter(Boolean));

  push(`Headline: ${b.problem?.headline ?? '(none given)'}`, '');

  if (b.contact) {
    push('CONTACT');
    push(
      bullet('Name', b.contact.name),
      bullet('Email', b.contact.email),
      bullet('Organization', b.contact.organization),
      bullet('Role', b.contact.role),
      '',
    );
  }

  if (b.problem) {
    push('PROBLEM');
    push(
      bullet('Narrative', b.problem.narrative),
      bullet('Today', b.problem.todayWorkflow),
      bullet('Why now', b.problem.triggerEvent),
      bullet('Frequency', b.problem.frequency),
      bullet(
        'Cost',
        b.problem.painCost?.value != null
          ? `${b.problem.painCost.value} ${b.problem.painCost.unit ?? ''}`.trim()
          : b.problem.painCost?.notes,
      ),
      bullet('Success looks like', list((b.problem.successCriteria ?? []).map((s) => s.statement))),
      '',
    );
  }

  if (b.users) {
    push('USERS');
    push(
      bullet('Primary', b.users.primary?.label),
      bullet('How many', b.users.primary?.countEstimate),
      bullet('Comfort with software', b.users.primary?.technicalComfort),
      bullet('Devices', list(b.users.primary?.devices)),
      bullet('Sign-in model', b.users.authModel),
      bullet('Administered by', b.users.adminOwner),
      '',
    );
  }

  if (b.platform) {
    push('PLATFORM');
    push(
      bullet('Target', b.platform.target),
      bullet('Offline', b.platform.offlineRequired ? `yes — ${b.platform.offlineReason ?? ''}` : null),
      bullet('Device features', list(b.platform.deviceCapabilities)),
      '',
    );
  }

  if (b.systems) {
    push('SYSTEMS THEY ALREADY USE');
    for (const s of b.systems.existing ?? []) {
      push(`  - ${s.vendor} (${s.role}${s.confidence === 'assumed' ? ', assumed' : ''})${s.catalogKey ? ` -> ${s.catalogKey}` : ' -> NO CONNECTOR'}`);
    }
    for (const s of b.systems.spreadsheetsOrDocs ?? []) {
      push(`  - spreadsheet: ${s.name}${s.whereStored ? ` in ${s.whereStored}` : ''}`);
    }
    push(bullet('Still on paper', list(b.systems.onPaper)), bullet('Must not disturb', list(b.systems.cannotChange)), '');
  }

  if (b.workflow) {
    push('WORKFLOW');
    for (const t of b.workflow.triggers ?? []) push(`  trigger (${t.kind}): ${t.detail}`);
    for (const s of (b.workflow.steps ?? []).slice().sort((x, y) => x.order - y.order)) {
      push(`  ${s.order}. [${s.actor}] ${s.action}`);
    }
    for (const o of b.workflow.outputs ?? []) push(`  output (${o.kind}): ${o.detail}${o.recipient ? ` -> ${o.recipient}` : ''}`);
    push('');
  }

  if (b.data?.entities?.length) {
    push('DATA');
    for (const e of b.data.entities) {
      push(`  ${e.name}${e.approxVolume ? ` (~${e.approxVolume})` : ''}: ${(e.fields ?? []).map((f) => `${f.name}:${f.type}`).join(', ')}`);
    }
    const sensitivity = Object.entries(b.data.sensitivity ?? {})
      .filter(([k, v]) => v === true && k !== 'notes')
      .map(([k]) => k);
    push(bullet('Sensitive', list(sensitivity)), '');
  }

  if (b.integrations?.length) {
    push('INTEGRATIONS NEEDED');
    for (const i of b.integrations) {
      push(`  ${i.catalogKey} (${i.direction}) — ${i.whatFor} [admin consent: ${i.hasAdminConsent}]`);
    }
    push('');
  }

  if (b.constraints) {
    push('CONSTRAINTS');
    push(
      bullet('Must have', list(b.constraints.mustHave)),
      bullet('Out of scope', list(b.constraints.outOfScope)),
      bullet('Compliance', list(b.constraints.compliance)),
      bullet('Deadline', b.constraints.deadline?.date),
      bullet('Budget', b.constraints.budget?.band),
      '',
    );
  }

  if (b.assessment) {
    push('OUR READ (generated, not the visitor’s words)');
    push(
      bullet('Fit', b.assessment.fitScore ? `${b.assessment.fitScore}/5` : null),
      bullet('Pattern', b.assessment.suggestedPattern),
      bullet('Complexity', b.assessment.estimatedComplexity),
      bullet('Buildable with what we have', b.assessment.buildableWithCatalog === false ? 'NO' : 'yes'),
      bullet('Missing connectors', list(b.assessment.missingConnectors)),
      bullet('Open questions', list(b.assessment.openQuestions)),
      bullet('Risks', list(b.assessment.risks)),
      bullet('Suggested shape', b.assessment.suggestedShape),
      '',
    );
  }

  push(`Completeness: ${b.completeness?.score ?? 0}/100`);
  if (b.completeness?.missingRequired?.length) {
    push(`Still missing: ${b.completeness.missingRequired.join('; ')}`);
  }

  return lines.join('\n');
}

/* --------------------------------------------------------------- the handler */

/**
 * @param {Request} request
 * @param {Record<string, unknown>} env
 * @param {{store?: object, anthropic?: object, now?: () => number,
 *          sendEmail?: Function, fetchImpl?: typeof fetch,
 *          newId?: () => string}} deps
 *   Injected so the tests never touch the network or a database.
 */
export async function handleIntake(request, env, deps = {}) {
  const asJson = wantsJson(request);
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const sendEmail = deps.sendEmail ?? defaultSendEmail;
  const fetchImpl = deps.fetchImpl ?? fetch;

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

  // Honeypot, before anything that costs money. 200 so the bot records a
  // success and does not retry.
  if (typeof data.companyUrl === 'string' && data.companyUrl.trim() !== '') {
    return asJson ? json({ ok: true }, 200) : htmlPage('Thank you', 'Thank you — we have got it.', 200);
  }

  // May be null, and that is survivable on the form path. Do not turn this
  // into an early return: see the note on formSubmission.
  const store = deps.store ?? (env.DB ? d1Store(env.DB) : null);

  // The form path has no Turnstile token to check -- the widget needs
  // JavaScript, and this is the path taken when there is none. The honeypot
  // above is what guards it, plus the fact that it costs at most one capped
  // model call.
  if (!asJson) {
    return formSubmission({ request, env, data, store, now, newId, sendEmail, deps });
  }

  // Everything below is the conversation, which genuinely cannot run without a
  // model and somewhere to keep the transcript.
  if (!env.ANTHROPIC_API_KEY || !store) {
    return unavailable(asJson, env, 'The problem solver is not finished being set up.');
  }

  // The fuse. Read before any model call.
  const budgetCents = num(env.INTAKE_DAILY_BUDGET_CENTS, 100);
  const today = dayKey(now());
  const spend = await store.readSpend(today);
  if (spend.est_cents >= budgetCents) {
    console.warn('intake: daily budget reached', { day: today, cents: spend.est_cents });
    return unavailable(asJson, env, 'The problem solver has hit its limit for today.');
  }

  return conversationTurn({ request, env, data, store, now, newId, sendEmail, fetchImpl, deps });
}

/** 503, never 500: the client reads any non-400 as "not the visitor's fault". */
function unavailable(asJson, env, message) {
  return asJson
    ? json({ error: message }, 503)
    : htmlPage(
        'Please email us directly',
        `${message} Please email ${env.BRIEF_TO ?? env.CONTACT_TO ?? DEFAULT_TO} and we will pick it up.`,
        503,
      );
}

/* ------------------------------------------------------------ the model call */

/**
 * The SDK is imported lazily so the tests, which always inject a fake, never
 * load it -- and so a Worker that never receives an intake request never pays
 * to parse it.
 */
async function getClient(env, deps) {
  if (deps.anthropic) return deps.anthropic;
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

/**
 * One request, one reply. Returns the next question, the brief the model wrote,
 * and what it cost.
 */
async function callModel(env, deps, { system, messages, toolChoice }) {
  const client = await getClient(env, deps);
  const model = env.INTAKE_MODEL || DEFAULT_MODEL;
  const effort = env.INTAKE_EFFORT || 'medium';

  const response = await client.messages.create({
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    // Thinking is on by default on Opus 5 and stays on deliberately: with it
    // disabled the model sometimes writes a tool call into visible text, the
    // call never runs, and nothing errors.
    output_config: { effort },
    system: [
      {
        type: 'text',
        text: system,
        // The stable prefix. Everything volatile is in `messages`, after this
        // breakpoint, so turns 2..n read ~5k tokens at a tenth of the price.
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [UPDATE_BRIEF_TOOL],
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
    messages,
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  const call = response.content.find(
    (block) => block.type === 'tool_use' && block.name === 'update_brief',
  );

  const usage = response.usage ?? {};
  const inputTokens =
    (usage.input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0);

  return {
    text,
    brief: call?.input ?? null,
    inputTokens,
    outputTokens: usage.output_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    model,
  };
}

/**
 * Accept the model's brief only if it validates. A brief that does not is
 * logged and dropped, and the previous one stands -- the conversation carries
 * on rather than 500ing in front of a visitor.
 */
function acceptBrief(candidate, previous) {
  if (!candidate || typeof candidate !== 'object') return previous;

  const { valid, errors } = validateBrief(candidate);
  if (!valid) {
    console.error('intake: model produced an invalid brief', errors.slice(0, 5));
    return previous;
  }
  return candidate;
}

/* ------------------------------------------------------ path 1: conversation */

async function conversationTurn({ request, env, data, store, now, newId, sendEmail, fetchImpl, deps }) {
  const message = String(data.message ?? '').trim();
  if (!message) return json({ error: 'Please write something first.' }, 400);
  if (message.length > MAX_MESSAGE_CHARS) {
    return json({ error: `Please keep it under ${MAX_MESSAGE_CHARS} characters.` }, 400);
  }

  const maxTurns = num(env.INTAKE_MAX_TURNS, 20);
  let session = null;

  if (data.sessionId) {
    session = await store.loadSession(String(data.sessionId));
    // An unknown id is not an error worth explaining; start fresh.
    if (session && session.status !== 'open') {
      return json({ error: 'That conversation has already finished.' }, 400);
    }
  }

  if (!session) {
    if (!(await turnstileOk(env, data.turnstileToken, request, fetchImpl))) {
      return json({ error: 'We could not verify that you are a person. Please reload and try again.' }, 403);
    }

    const ipHash = await hashIp(request, env.INTAKE_SALT);
    const recent = await store.countRecentSessions(ipHash, now() - DAY_MS);
    if (recent >= MAX_NEW_SESSIONS_PER_IP_PER_DAY) {
      return json(
        { error: 'You have started several of these today. Email us directly and we will pick it up.' },
        429,
      );
    }

    session = await store.createSession({ id: newId(), ipHash, now: now() });
  }

  if (session.turns >= maxTurns || (session.inputTokens ?? 0) >= MAX_SESSION_INPUT_TOKENS) {
    return finish({
      env, store, session, sendEmail, now, newId,
      brief: session.brief ?? emptyBrief(),
      reply:
        'We have covered a lot — let us stop there. Someone from Invicti.Works will read this through and email you.',
      status: 'capped',
    });
  }

  // The brief so far rides in the last user message, not in the system prompt,
  // so the cached prefix stays byte-identical from turn to turn.
  const history = session.messages.map((m) => ({ role: m.role, content: m.content }));
  const messages = [
    ...history,
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `<brief_so_far>\n${JSON.stringify(session.brief ?? emptyBrief(), null, 1)}\n</brief_so_far>`,
        },
        {
          type: 'text',
          text: `<visitor_message>\n${message}\n</visitor_message>`,
        },
      ],
    },
  ];

  let result;
  try {
    result = await callModel(env, deps, { system: SYSTEM_PROMPT, messages });
  } catch (error) {
    console.error('intake: model call failed', error?.status ?? error?.name ?? 'unknown');
    return json({ error: 'We could not reach the assistant just now.' }, 502);
  }

  await store.addSpend(dayKey(now()), {
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    cents: estimateCents(result.model, result.inputTokens, result.outputTokens),
  });

  const brief = acceptBrief(result.brief, session.brief ?? emptyBrief());
  const reply =
    result.text ||
    'Thanks — could you tell me a little more about that?';
  const turns = session.turns + 1;
  const complete = brief?.completeness?.interviewComplete === true || turns >= maxTurns;

  await store.appendMessages(
    session.id,
    [
      { role: 'user', content: message },
      { role: 'assistant', content: reply },
    ],
    session.messages.length,
    now(),
  );

  await store.saveTurn(session.id, {
    brief,
    completeness: brief?.completeness?.score ?? 0,
    turns,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    status: complete ? 'complete' : 'open',
    now: now(),
  });

  if (!complete) {
    return json(
      {
        sessionId: session.id,
        reply,
        brief,
        turn: turns,
        maxTurns,
        complete: false,
      },
      200,
    );
  }

  return finish({ env, store, session: { ...session, turns }, sendEmail, now, newId, brief, reply, status: 'complete' });
}

/* ------------------------------------------------------------ path 2: form */

/**
 * The no-JavaScript path, and the one that must never break.
 *
 * It is the only way to reach us from /build before any of docs/SETUP.md step
 * 12 is done, and the only one for a visitor whose browser runs no scripts. So
 * the model is a bonus here and the database is a bonus here: with neither
 * configured this still stores nothing, structures nothing, and emails the
 * answers exactly as typed. The only thing that can fail it is Resend, and
 * that is the same single point of failure the contact form has always had.
 *
 * An earlier version returned 503 from handleIntake when ANTHROPIC_API_KEY was
 * missing, before this function was ever reached -- which contradicted the
 * comment above it and would have silently swallowed every lead the day the
 * home page stopped offering a second form.
 */
/**
 * One form answer as text, for the email and for the model.
 *
 * The pills post as a repeated key, so `data.tools` is an array of the labels
 * ticked (or a bare string when exactly one was). Anything not on the list we
 * offered is dropped rather than passed on: the values arrive from the client
 * and nothing downstream should have to wonder whether a label is ours.
 */
function answerText(value, field) {
  if (field.type === 'pills') {
    const offered = new Set(field.groups?.flatMap((g) => g.options) ?? []);
    const picked = (Array.isArray(value) ? value : [value])
      .map((v) => String(v ?? '').trim())
      .filter((v) => offered.has(v));
    return picked.join(', ');
  }
  return String(Array.isArray(value) ? value.join(', ') : (value ?? '')).trim();
}

async function formSubmission({ request, env, data, store, now, newId, sendEmail, deps }) {
  const name = String(data.name ?? '').trim();
  const email = String(data.email ?? '').trim();
  const problem = String(data.problem ?? '').trim();

  if (!name || !email || !problem) {
    const error = 'Please give your name, your email and a short description of the problem.';
    return htmlPage('Almost there', error, 400);
  }
  if (!looksLikeEmail(email)) {
    return htmlPage('Almost there', 'That email address does not look right.', 400);
  }

  const answers = FORM_FIELDS.map((field) => {
    const value = answerText(data[field.name], field);
    return value ? `${field.label}\n${value}` : null;
  })
    .filter(Boolean)
    .join('\n\n');

  const ipHash = await hashIp(request, env.INTAKE_SALT);
  const session = store
    ? await store.createSession({ id: newId(), ipHash, now: now() })
    : { id: newId(), messages: [] };

  // The model is a bonus on this path, never a dependency: whatever happens
  // next, the raw answers are emailed, and stored too if there is a database.
  let brief = emptyBrief('form');
  try {
    if (!env.ANTHROPIC_API_KEY) throw new Error('no api key');
    const result = await callModel(env, deps, {
      system: `${SYSTEM_PROMPT}\n\n${FORM_STRUCTURING_PROMPT}`,
      messages: [{ role: 'user', content: `<form_answers>\n${answers}\n</form_answers>` }],
      toolChoice: { type: 'tool', name: 'update_brief' },
    });

    await store?.addSpend(dayKey(now()), {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cents: estimateCents(result.model, result.inputTokens, result.outputTokens),
    });

    brief = acceptBrief(result.brief, brief);
  } catch (error) {
    console.error('intake: form structuring skipped, emailing raw answers', error?.status ?? error?.message);
  }

  if (store) {
    await store.appendMessages(session.id, [{ role: 'user', content: answers }], 0, now());
    await store.saveTurn(session.id, {
      brief,
      completeness: brief?.completeness?.score ?? 0,
      turns: 1,
      inputTokens: 0,
      outputTokens: 0,
      status: 'complete',
      now: now(),
    });
  }

  const { emailed } = await persist({
    env, store, sendEmail, now, newId, brief, session,
    fallback: { name, email, organization: String(data.organization ?? '').trim(), answers },
  });

  // Resend is the only genuine dependency left. If it fails, say so rather
  // than thanking someone for a message that went nowhere.
  if (!emailed) {
    return htmlPage(
      'Please email us directly',
      `We could not send that just now. Please email ${env.BRIEF_TO ?? env.CONTACT_TO ?? DEFAULT_TO} and we will pick it up.`,
      502,
    );
  }

  return htmlPage(
    'Thank you',
    'We have got it. Someone from Invicti.Works will read it through and email you.',
    200,
  );
}

/* ---------------------------------------------------------------- finishing */

async function finish({ env, store, session, sendEmail, now, newId, brief, reply, status }) {
  const record = await persist({ env, store, sendEmail, now, newId, brief, session });

  await store.saveTurn(session.id, {
    brief,
    completeness: brief?.completeness?.score ?? 0,
    turns: session.turns,
    inputTokens: 0,
    outputTokens: 0,
    status,
    now: now(),
  });

  return json(
    {
      sessionId: session.id,
      reply,
      brief,
      complete: true,
      saved: true,
      emailed: record.emailed,
      briefId: record.id,
    },
    200,
  );
}

/**
 * Write the brief, then email it. In that order, always: D1 first means nothing
 * third-party can lose a brief. A failed send is reported as
 * `emailed: false` alongside `saved: true` rather than as an error, because the
 * brief is safe and saying otherwise would be a lie.
 */
async function persist({ env, store, sendEmail, now, newId, brief, session, fallback }) {
  const id = newId();
  const createdAt = now();
  const contactEmail = brief?.contact?.email ?? fallback?.email ?? null;

  const record = {
    id,
    sessionId: session.id,
    createdAt,
    email: contactEmail,
    name: brief?.contact?.name ?? fallback?.name ?? null,
    organization: brief?.contact?.organization ?? fallback?.organization ?? null,
    headline: brief?.problem?.headline ?? null,
    complexity: brief?.assessment?.estimatedComplexity ?? null,
    completeness: brief?.completeness?.score ?? 0,
    json: brief,
    emailedAt: null,
  };

  await store?.saveBrief(record);

  const body = [
    briefToText(brief),
    fallback ? `\n\nRAW ANSWERS AS TYPED\n${fallback.answers}` : '',
    `\n\n---\nBrief ${id} · session ${session.id}\n`,
    JSON.stringify(brief, null, 2),
  ].join('');

  const subject = `Build brief — ${record.headline ?? record.name ?? 'new enquiry'}${
    record.organization ? ` (${record.organization})` : ''
  }`;

  const sent = await sendEmail(env, {
    to: env.BRIEF_TO ?? env.CONTACT_TO ?? DEFAULT_TO,
    from: env.BRIEF_FROM ?? env.CONTACT_FROM,
    replyTo: contactEmail && looksLikeEmail(contactEmail) ? contactEmail : undefined,
    subject,
    text: body,
  });

  if (sent.ok) {
    record.emailedAt = now();
    await store?.saveBrief(record);
  }

  // A copy to the visitor, if they gave a usable address. Best effort: their
  // confirmation failing must not affect ours.
  if (sent.ok && contactEmail && looksLikeEmail(contactEmail)) {
    try {
      await sendEmail(env, {
        to: contactEmail,
        from: env.BRIEF_FROM ?? env.CONTACT_FROM,
        subject: 'Your Invicti.Works build brief',
        text: [
          `Thanks for telling us about this. Here is what we captured — if anything is`,
          `wrong or missing, just reply to this email and say so.`,
          '',
          briefToText(brief),
          '',
          'Someone will read it through and come back to you.',
          '',
          '— Invicti.Works',
        ].join('\n'),
      });
    } catch (error) {
      console.error('intake: visitor copy failed', error?.name ?? 'unknown');
    }
  }

  return { id, emailed: sent.ok };
}
