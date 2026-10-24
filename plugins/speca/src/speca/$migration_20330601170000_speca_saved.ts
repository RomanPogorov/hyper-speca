// Speca's "Saved" (web/saved.ts): the person's own storage — messages saved from chats, notes, links, things the agent
// was asked to remember. Never shown to anyone else. Additive.
export default {
    async up(ctx: Context) {
        await ctx.fns.procs.db.exec({
            sql: `CREATE TABLE IF NOT EXISTS speca_saved (
                id BIGSERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT 'note',
                text TEXT NOT NULL,
                source JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at BIGINT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS speca_saved_user ON speca_saved (user_id, created_at DESC);`,
        });
    },
    async down(ctx: Context) {
        await ctx.fns.procs.db.exec({ sql: `DROP TABLE IF EXISTS speca_saved` });
    },
};
