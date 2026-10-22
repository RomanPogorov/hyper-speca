// Final step of v2: wake/cron/watch live in jobs + job_runs. Copy anything still left in the old
// tables (rows created by a pre-v2 worker after 20331022120000_schedules ran), then drop them.
// Idempotent: every copy is ON CONFLICT DO NOTHING.
// hyper-code2: `left(x || '', n)` — see 20331022120000_schedules: Postgres 18.2 reports invalid UTF8 when
// left() on a compressed text cuts inside a Cyrillic character; the concatenation detoasts it whole first.
const upSql = `
INSERT INTO jobs (id, kind, runner, spec, state, status, outcome_reason, owner_id, created_by, agent_id, prompt,
                  execution_id, next_at, created_at, started_at, deadline_at, finished_at, updated_at)
SELECT t.id,
       CASE WHEN t.kind = 'watch' THEN 'subscription' ELSE 'schedule' END,
       t.kind,
       jsonb_strip_nulls(jsonb_build_object(
           'title', left(t.prompt || '', 120),
           'expression', t.config->'expression',
           'timezone', t.timezone,
           'predicate', t.config->'predicate',
           'opts', t.config->'opts',
           'everyMs', t.config->'everyMs',
           'onTimeoutPrompt', t.config->'onTimeoutPrompt',
           'mode', t.mode)),
       jsonb_strip_nulls(jsonb_build_object('lastReady', t.last_ready, 'attempts', t.attempts, 'lastError', t.last_error)),
       CASE t.status WHEN 'active' THEN 'running' WHEN 'checking' THEN 'running' WHEN 'completed' THEN 'succeeded'
                     WHEN 'timed_out' THEN 'timeout' ELSE 'cancelled' END,
       CASE t.status WHEN 'completed' THEN 'fired' WHEN 'timed_out' THEN 'timeout' WHEN 'cancelled' THEN 'cancelled' ELSE NULL END,
       a.created_by, 'migration', t.agent_id, t.prompt,
       t.id,
       CASE WHEN t.status IN ('active', 'checking') THEN COALESCE(t.next_at, t.updated_at) ELSE NULL END,
       t.created_at, t.created_at, t.timeout_at, t.finished_at, t.updated_at
  FROM agent_triggers t JOIN agents a ON a.id = t.agent_id
ON CONFLICT (id) DO NOTHING;

INSERT INTO job_runs (job_id, scheduled_at, outcome, result, result_ref, error, created_at)
SELECT r.trigger_id, r.scheduled_at, r.outcome, r.result, r.result_ref, r.error, r.created_at
  FROM agent_trigger_runs r JOIN jobs j ON j.id = r.trigger_id
 ORDER BY r.id
ON CONFLICT DO NOTHING;

INSERT INTO jobs (id, kind, runner, spec, state, status, owner_id, created_by, agent_id, prompt,
                  execution_id, next_at, created_at, started_at, deadline_at, updated_at)
SELECT w.id, 'subscription', 'watch',
       jsonb_build_object('title', left(w.reason || '', 120), 'predicate', w.predicate, 'opts', w.opts, 'everyMs', w.interval_ms, 'mode', 'once'),
       jsonb_build_object('attempts', w.attempts),
       'running', a.created_by, 'migration', w.agent_id, w.reason,
       w.id, w.next_check_at, w.created_at, w.created_at, w.timeout_at, w.created_at
  FROM agent_watches w JOIN agents a ON a.id = w.agent_id
 WHERE w.status IN ('active', 'checking')
ON CONFLICT (id) DO NOTHING;

DROP TABLE agent_trigger_runs;
DROP TABLE agent_triggers;
DROP TABLE agent_watches;
`;

export default {
    up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: upSql }); },
    // Data is not restored; down only recreates empty tables so older migrations' downs keep working.
    down: async (ctx: Context) => {
        await ctx.fns.procs.db.exec({ sql: `
CREATE TABLE IF NOT EXISTS agent_watches (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, predicate TEXT NOT NULL, opts JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT NOT NULL, interval_ms BIGINT NOT NULL, next_check_at BIGINT NOT NULL, timeout_at BIGINT NOT NULL, status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, last_result JSONB, created_at BIGINT NOT NULL, finished_at BIGINT);
CREATE TABLE IF NOT EXISTS agent_triggers (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, kind TEXT NOT NULL, prompt TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb, timezone TEXT, mode TEXT NOT NULL DEFAULT 'once', status TEXT NOT NULL DEFAULT 'active',
  next_at BIGINT, timeout_at BIGINT, last_ready BOOLEAN NOT NULL DEFAULT FALSE, attempts INTEGER NOT NULL DEFAULT 0, claim_token TEXT,
  claimed_at BIGINT, last_error TEXT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, finished_at BIGINT);
CREATE TABLE IF NOT EXISTS agent_trigger_runs (id BIGSERIAL PRIMARY KEY, trigger_id TEXT NOT NULL REFERENCES agent_triggers(id) ON DELETE CASCADE,
  scheduled_at BIGINT NOT NULL, outcome TEXT NOT NULL, result JSONB, result_ref JSONB, error TEXT, created_at BIGINT NOT NULL,
  UNIQUE(trigger_id, scheduled_at, outcome));` });
    },
};
