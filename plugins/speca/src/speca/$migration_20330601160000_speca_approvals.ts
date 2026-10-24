// Speca's confirmations (web/approvals.ts): a tool call held for the person's decision (an approval card in the chat),
// a plan put up for approval in plan mode, questions to the person. One row per ask; the decision is on the row.
// Additive.
export default {
    async up(ctx: Context) {
        await ctx.fns.procs.db.exec({
            sql: `CREATE TABLE IF NOT EXISTS speca_approvals (
                id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL,
                chat_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                tool TEXT,
                effect TEXT,
                plugin TEXT,
                summary TEXT NOT NULL DEFAULT '',
                preview JSONB,
                preview_hash TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                note TEXT,
                answer JSONB,
                created_at BIGINT NOT NULL,
                decided_at BIGINT,
                expires_at BIGINT
            );
            CREATE INDEX IF NOT EXISTS speca_approvals_chat ON speca_approvals (chat_id, status);
            CREATE INDEX IF NOT EXISTS speca_approvals_agent ON speca_approvals (agent_id, status);`,
        });
    },
    async down(ctx: Context) {
        await ctx.fns.procs.db.exec({ sql: `DROP TABLE IF EXISTS speca_approvals` });
    },
};
