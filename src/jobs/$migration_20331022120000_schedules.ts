// v2: wake/cron/watch become jobs rows (kind schedule|subscription, runner at|cron|watch).
// job_runs keeps the per-occurrence audit that agent_trigger_runs kept. Every existing
// agent_triggers row (and any legacy agent_watches row still active) is copied over with its
// history; the copied active rows are cancelled in the old tables so nothing fires twice.
// The old tables stay until a separate, explicit drop.
//
// hyper-code2: `left(x || '', n)`, not `left(x, n)`. On a compressed text Postgres 18.2 decompresses only
// the prefix `left` needs; when that prefix ends inside a multibyte (Cyrillic) character it reports
// "invalid byte sequence for encoding UTF8" on perfectly valid data, and the boot failed on one prompt.
// The concatenation detoasts the whole value first.
const upSql = `
CREATE TABLE IF NOT EXISTS job_runs (
    id BIGSERIAL PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    scheduled_at BIGINT NOT NULL,
    outcome TEXT NOT NULL,
    result JSONB,
    result_ref JSONB,
    error TEXT,
    created_at BIGINT NOT NULL,
    UNIQUE (job_id, scheduled_at, outcome)
);
CREATE INDEX IF NOT EXISTS job_runs_job_idx ON job_runs (job_id, id DESC);

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

UPDATE agent_triggers SET status = 'cancelled', next_at = NULL, claim_token = NULL, last_error = 'moved to jobs',
       finished_at = COALESCE(finished_at, (extract(epoch from now()) * 1000)::bigint)
 WHERE status IN ('active', 'checking');

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

UPDATE agent_watches SET status = 'cancelled', last_error = 'moved to jobs' WHERE status IN ('active', 'checking');
`;

export default {
    up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: upSql }); },
    down: async (ctx: Context) => {
        await ctx.fns.procs.db.exec({ sql: "DROP TABLE IF EXISTS job_runs; DELETE FROM jobs WHERE runner IN ('at', 'cron', 'watch');" });
    },
};
