// What Speca's interface keeps per person on top of Hyper's agents: a chat's marks (seen up to, pinned, the autonomy
// level and plan mode) and the person's interface settings (theme, layout, defaults). Additive.
export default {
    async up(ctx: Context) {
        await ctx.fns.procs.db.exec({
            sql: `CREATE TABLE IF NOT EXISTS speca_chat (
                agent_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                seen_idx INTEGER,
                pinned BOOLEAN,
                autonomy TEXT,
                mode TEXT,
                PRIMARY KEY (agent_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS speca_user (
                user_id TEXT PRIMARY KEY,
                settings JSONB NOT NULL DEFAULT '{}'::jsonb
            );`,
        });
    },
    async down(ctx: Context) {
        await ctx.fns.procs.db.exec({ sql: `DROP TABLE IF EXISTS speca_chat; DROP TABLE IF EXISTS speca_user` });
    },
};
