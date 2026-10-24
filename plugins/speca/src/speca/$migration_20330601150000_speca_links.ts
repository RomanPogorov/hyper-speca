// Speca's design ↔ prototype link (web/proto.ts): a tab built from another (an html prototype of a design canvas)
// remembers its source, both fingerprints and both states at the last sync — so either side shows when the other
// changed since, and the agent reads exactly what changed. Additive.
export default {
    async up(ctx: Context) {
        await ctx.fns.procs.db.exec({
            sql: `CREATE TABLE IF NOT EXISTS speca_links (
                built_id BIGINT PRIMARY KEY,
                source_id BIGINT NOT NULL,
                agent_id TEXT NOT NULL,
                source_key TEXT,
                built_key TEXT,
                source_base JSONB,
                built_base JSONB,
                sync_dir TEXT,
                sync_at BIGINT,
                synced_at BIGINT,
                created_at BIGINT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS speca_links_source ON speca_links (source_id);`,
        });
    },
    async down(ctx: Context) {
        await ctx.fns.procs.db.exec({ sql: `DROP TABLE IF EXISTS speca_links` });
    },
};
