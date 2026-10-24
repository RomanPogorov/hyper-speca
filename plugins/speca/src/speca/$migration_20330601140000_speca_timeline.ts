// Speca's timeline (web/timeline.ts): every finished turn of a chat as one entry — what was asked and answered, what it
// changed (facts from the log) and one short "what was done" a cheap model writes once. Additive.
export default {
    async up(ctx: Context) {
        await ctx.fns.procs.db.exec({
            sql: `CREATE TABLE IF NOT EXISTS speca_timeline (
                agent_id TEXT NOT NULL,
                turn_id TEXT NOT NULL,
                project_id TEXT,
                start_idx INTEGER NOT NULL,
                end_idx INTEGER NOT NULL,
                at BIGINT NOT NULL,
                ms BIGINT,
                asked TEXT NOT NULL DEFAULT '',
                said TEXT NOT NULL DEFAULT '',
                facts JSONB NOT NULL DEFAULT '{}'::jsonb,
                summary TEXT,
                summary_state TEXT NOT NULL DEFAULT 'none',
                PRIMARY KEY (agent_id, turn_id)
            );
            CREATE INDEX IF NOT EXISTS speca_timeline_project ON speca_timeline (project_id, at DESC);
            CREATE INDEX IF NOT EXISTS speca_timeline_agent ON speca_timeline (agent_id, at DESC);`,
        });
    },
    async down(ctx: Context) {
        await ctx.fns.procs.db.exec({ sql: `DROP TABLE IF EXISTS speca_timeline` });
    },
};
