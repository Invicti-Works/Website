/**
 * Persistence for the intake conversation.
 *
 * Two implementations behind one interface: `d1Store(db)` for production and
 * `memoryStore()` for the tests, which must never touch the network or a real
 * database. worker/intake.js takes the store as an injected dependency and does
 * not know which it has.
 *
 * The transcript lives here rather than in the browser on purpose. A
 * client-supplied transcript is attacker-supplied: anyone could forge assistant
 * turns and use /api/intake as a free, prompt-injectable LLM proxy on our card.
 * Signing every transcript to defend that would be worse state management than
 * a table. The client holds only the session id.
 */

/** UTC day key for the spend fuse. */
export const dayKey = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

/* --------------------------------------------------------------- D1 backing */

export function d1Store(db) {
  return {
    async createSession({ id, ipHash, now }) {
      await db
        .prepare(
          `INSERT INTO intake_sessions (id, created_at, updated_at, status, ip_hash)
           VALUES (?, ?, ?, 'open', ?)`,
        )
        .bind(id, now, now, ipHash)
        .run();
      return { id, status: 'open', turns: 0, brief: null, messages: [] };
    },

    async loadSession(id) {
      const row = await db
        .prepare(`SELECT * FROM intake_sessions WHERE id = ?`)
        .bind(id)
        .first();
      if (!row) return null;

      const { results } = await db
        .prepare(`SELECT role, content FROM intake_messages WHERE session_id = ? ORDER BY seq`)
        .bind(id)
        .all();

      return {
        id: row.id,
        status: row.status,
        turns: row.turns,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        completeness: row.completeness,
        brief: row.brief_json ? JSON.parse(row.brief_json) : null,
        messages: results ?? [],
      };
    },

    async appendMessages(sessionId, messages, startSeq, now) {
      // batch() is one round trip and one implicit transaction, which matters:
      // a half-written turn would desynchronise the transcript from the count.
      await db.batch(
        messages.map((m, i) =>
          db
            .prepare(
              `INSERT INTO intake_messages (session_id, seq, role, content, created_at)
               VALUES (?, ?, ?, ?, ?)`,
            )
            .bind(sessionId, startSeq + i, m.role, m.content, now),
        ),
      );
    },

    async saveTurn(sessionId, { brief, completeness, turns, inputTokens, outputTokens, status, now }) {
      await db
        .prepare(
          `UPDATE intake_sessions
              SET updated_at = ?, status = ?, turns = ?, completeness = ?,
                  brief_json = ?,
                  input_tokens = input_tokens + ?, output_tokens = output_tokens + ?
            WHERE id = ?`,
        )
        .bind(
          now,
          status,
          turns,
          completeness,
          brief ? JSON.stringify(brief) : null,
          inputTokens,
          outputTokens,
          sessionId,
        )
        .run();
    },

    async saveBrief(brief) {
      await db
        .prepare(
          `INSERT INTO briefs (id, session_id, created_at, email, name, organization,
                               headline, complexity, brief_json, completeness, emailed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             brief_json = excluded.brief_json,
             completeness = excluded.completeness,
             headline = excluded.headline,
             emailed_at = excluded.emailed_at`,
        )
        .bind(
          brief.id,
          brief.sessionId,
          brief.createdAt,
          brief.email,
          brief.name,
          brief.organization,
          brief.headline,
          brief.complexity,
          JSON.stringify(brief.json),
          brief.completeness,
          brief.emailedAt ?? null,
        )
        .run();
    },

    async readSpend(day) {
      const row = await db.prepare(`SELECT * FROM ai_usage WHERE day = ?`).bind(day).first();
      return row ?? { day, input_tokens: 0, output_tokens: 0, est_cents: 0, calls: 0 };
    },

    async addSpend(day, { inputTokens, outputTokens, cents }) {
      await db
        .prepare(
          `INSERT INTO ai_usage (day, input_tokens, output_tokens, est_cents, calls)
           VALUES (?, ?, ?, ?, 1)
           ON CONFLICT(day) DO UPDATE SET
             input_tokens  = input_tokens  + excluded.input_tokens,
             output_tokens = output_tokens + excluded.output_tokens,
             est_cents     = est_cents     + excluded.est_cents,
             calls         = calls + 1`,
        )
        .bind(day, inputTokens, outputTokens, cents)
        .run();
    },

    async countRecentSessions(ipHash, since) {
      if (!ipHash) return 0;
      const row = await db
        .prepare(`SELECT COUNT(*) AS n FROM intake_sessions WHERE ip_hash = ? AND created_at > ?`)
        .bind(ipHash, since)
        .first();
      return row?.n ?? 0;
    },

    /* ---- read side, for the founders' console (worker/console.js) ---- */

    /**
     * The list view. Deliberately does NOT select brief_json: the console shows
     * twenty rows at a time and each brief is several kilobytes of JSON, so
     * sending them all would make the list slow for data nothing renders.
     */
    async listBriefs({ limit = 50, state = null } = {}) {
      const query = state
        ? db
            .prepare(
              `SELECT id, created_at, email, name, organization, headline, complexity,
                      completeness, emailed_at, build_state, build_ref
                 FROM briefs WHERE build_state = ? ORDER BY created_at DESC LIMIT ?`,
            )
            .bind(state, limit)
        : db
            .prepare(
              `SELECT id, created_at, email, name, organization, headline, complexity,
                      completeness, emailed_at, build_state, build_ref
                 FROM briefs ORDER BY created_at DESC LIMIT ?`,
            )
            .bind(limit);

      const { results } = await query.all();
      return results ?? [];
    },

    async getBrief(id) {
      const row = await db.prepare(`SELECT * FROM briefs WHERE id = ?`).bind(id).first();
      if (!row) return null;
      return { ...row, brief: JSON.parse(row.brief_json) };
    },

    async setBuildState(id, state, ref = null) {
      await db
        .prepare(
          `UPDATE briefs SET build_state = ?, build_ref = COALESCE(?, build_ref) WHERE id = ?`,
        )
        .bind(state, ref, id)
        .run();
    },

    /** Counts by state, for the header on the list page. */
    async briefCounts() {
      const { results } = await db
        .prepare(`SELECT build_state, COUNT(*) AS n FROM briefs GROUP BY build_state`)
        .all();
      return Object.fromEntries((results ?? []).map((r) => [r.build_state, r.n]));
    },
  };
}

/* --------------------------------------------------------- in-memory backing */

/** Same interface, no I/O. Used by worker/intake.test.mjs. */
export function memoryStore() {
  const sessions = new Map();
  const messages = new Map();
  const briefs = [];
  const spend = new Map();

  return {
    _sessions: sessions,
    _briefs: briefs,
    _spend: spend,

    async createSession({ id, ipHash, now }) {
      const session = {
        id,
        status: 'open',
        turns: 0,
        inputTokens: 0,
        outputTokens: 0,
        completeness: 0,
        brief: null,
        ipHash,
        createdAt: now,
      };
      sessions.set(id, session);
      messages.set(id, []);
      return { ...session, messages: [] };
    },

    async loadSession(id) {
      const session = sessions.get(id);
      return session ? { ...session, messages: [...(messages.get(id) ?? [])] } : null;
    },

    async appendMessages(sessionId, list) {
      messages.get(sessionId)?.push(...list.map((m) => ({ role: m.role, content: m.content })));
    },

    async saveTurn(sessionId, patch) {
      const session = sessions.get(sessionId);
      if (!session) return;
      Object.assign(session, {
        status: patch.status,
        turns: patch.turns,
        completeness: patch.completeness,
        brief: patch.brief,
        inputTokens: session.inputTokens + patch.inputTokens,
        outputTokens: session.outputTokens + patch.outputTokens,
      });
    },

    async saveBrief(brief) {
      // Upsert, mirroring the D1 implementation's ON CONFLICT. persist() saves
      // once before emailing and again after, and a sibling that appended twice
      // would let a double-write bug pass here and fail in production.
      const existing = briefs.findIndex((b) => b.id === brief.id);
      if (existing === -1) briefs.push({ ...brief });
      else briefs[existing] = { ...brief };
    },

    async readSpend(day) {
      return spend.get(day) ?? { day, input_tokens: 0, output_tokens: 0, est_cents: 0, calls: 0 };
    },

    async addSpend(day, { inputTokens, outputTokens, cents }) {
      const current = spend.get(day) ?? { day, input_tokens: 0, output_tokens: 0, est_cents: 0, calls: 0 };
      spend.set(day, {
        day,
        input_tokens: current.input_tokens + inputTokens,
        output_tokens: current.output_tokens + outputTokens,
        est_cents: current.est_cents + cents,
        calls: current.calls + 1,
      });
    },

    async countRecentSessions(ipHash) {
      if (!ipHash) return 0;
      return [...sessions.values()].filter((s) => s.ipHash === ipHash).length;
    },

    async listBriefs({ limit = 50, state = null } = {}) {
      return briefs
        .filter((b) => !state || (b.build_state ?? 'new') === state)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit)
        .map(({ json, ...rest }) => ({ ...rest, build_state: rest.build_state ?? 'new' }));
    },

    async getBrief(id) {
      const found = briefs.find((b) => b.id === id);
      return found ? { ...found, brief: found.json, build_state: found.build_state ?? 'new' } : null;
    },

    async setBuildState(id, state, ref = null) {
      const found = briefs.find((b) => b.id === id);
      if (!found) return;
      found.build_state = state;
      if (ref) found.build_ref = ref;
    },

    async briefCounts() {
      const counts = {};
      for (const b of briefs) {
        const state = b.build_state ?? 'new';
        counts[state] = (counts[state] ?? 0) + 1;
      }
      return counts;
    },
  };
}
