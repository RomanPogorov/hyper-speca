/**
 * Turn a plugin on or off for one person (the caller by default). Off means: the person's agents do not see it
 * in their plugin list or in plugins.search. The plugin stays mounted for everybody else.
 * @param opts.plugin Plugin name as in plugins.list.
 * @param opts.enabled true = on (the default state, the row is removed), false = off.
 * @param opts.user Person to change instead of the caller.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Plugin name as in plugins.list. */
        plugin: string;
        /** true = on (the default state, the row is removed), false = off. */
        enabled: boolean;
        /** Person to change instead of the caller. */
        user?: string;
    },
): Promise<{ ok: true; plugin: string; enabled: boolean; user: string }> {
    const plugin = String(opts.plugin ?? "").trim();
    if (!plugin) throw new Error("plugins.setEnabled: plugin is required");
    const user = opts.user ?? await ctx.fns.auth.ownerId({});
    if (!user) throw new Error("plugins.setEnabled: no signed-in person — on an instance without users plugins are on for everybody");
    const known = (ctx.fns.plugins.list({}) as any[]).some((p: any) => p.name === plugin);
    if (!known) throw new Error(`plugins.setEnabled: unknown plugin ${plugin}`);
    if (opts.enabled) {
        await ctx.fns.procs.db.run({ sql: "DELETE FROM user_plugins WHERE user_id = ? AND plugin = ?", params: [user, plugin] });
    } else {
        await ctx.fns.procs.db.run({
            sql: `INSERT INTO user_plugins(user_id, plugin, enabled, updated_at) VALUES (?,?,false,?)
                  ON CONFLICT(user_id, plugin) DO UPDATE SET enabled = false, updated_at = excluded.updated_at`,
            params: [user, plugin, Date.now()],
        });
    }
    (ctx.state as any).userPlugins?.delete(user);
    ctx.fns.procs.events.refresh({ topic: "plugins", reason: "user-toggle" });
    return { ok: true, plugin, enabled: Boolean(opts.enabled), user };
}
