// jobs: one table for work that outlives a tool call and reports back to exactly one agent.
// v1 runs kind='exec' (runner bash | sleep); schedule/subscription arrive in v2/v3 as rows,
// not schema. The finish of a job and its inbox message commit together (agent.deliver).
const upSql = `
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL DEFAULT 'exec',
    runner TEXT NOT NULL,
    spec JSONB NOT NULL DEFAULT '{}'::jsonb,
    state JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL,
    outcome_reason TEXT,
    owner_id TEXT,
    created_by TEXT,
    agent_id TEXT NOT NULL,
    prompt TEXT,
    origin_tool_call_id TEXT,
    execution_id TEXT NOT NULL UNIQUE,
    next_at BIGINT,
    lease_token TEXT,
    lease_expires_at BIGINT,
    cancel_requested_at BIGINT,
    result JSONB,
    created_at BIGINT NOT NULL,
    started_at BIGINT,
    deadline_at BIGINT,
    finished_at BIGINT,
    updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_due_idx ON jobs (next_at) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS jobs_agent_idx ON jobs (agent_id, created_at DESC);
`;

export default {
    up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: upSql }); },
    down: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: "DROP TABLE IF EXISTS jobs" }); },
};
