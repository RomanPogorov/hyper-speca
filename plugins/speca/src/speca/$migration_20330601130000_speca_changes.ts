// What the agent (or the person, by hand) changed in a chat's workspace folder, turn by turn: the two snapshot trees
// and the files between them (web/code/changes.ts); and the notes the agent reads before its next turn (a file the
// person edited in the Files tab, a revert). Additive.
export default {
    async up(ctx: Context) {
        await ctx.fns.procs.db.exec({
            sql: `CREATE TABLE IF NOT EXISTS speca_turn_changes (
                agent_id TEXT NOT NULL,
                turn_id TEXT NOT NULL,
                dir TEXT NOT NULL,
                store TEXT NOT NULL,
                before_tree TEXT NOT NULL,
                after_tree TEXT NOT NULL,
                files JSONB NOT NULL DEFAULT '[]'::jsonb,
                added INTEGER NOT NULL DEFAULT 0,
                removed INTEGER NOT NULL DEFAULT 0,
                author TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                PRIMARY KEY (agent_id, turn_id)
            );
            CREATE TABLE IF NOT EXISTS speca_note (
                agent_id TEXT NOT NULL,
                key TEXT NOT NULL,
                text TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                PRIMARY KEY (agent_id, key)
            );`,
        });
    },
    async down(ctx: Context) {
        await ctx.fns.procs.db.exec({ sql: `DROP TABLE IF EXISTS speca_turn_changes; DROP TABLE IF EXISTS speca_note` });
    },
};
