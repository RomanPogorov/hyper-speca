/**
 * Plugins a person turned off for themselves (user_plugins, enabled = false).
 *
 * Whose: `opts.user` when given, else auth.ownerId (the signed-in person, or the creator of the agent the call
 * runs for). No owner → nothing is off. Cached per person in ctx.state.userPlugins; plugins.setEnabled clears it.
 * @param opts.user Person to ask about instead of the caller.
 * @param opts.agentId Agent the call runs for, when the session does not say it.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts?: {
        /** Person to ask about instead of the caller. */
        user?: string;
        /** Agent the call runs for, when the session does not say it. */
        agentId?: string;
    },
): Promise<string[]> {
    const user = opts?.user ?? await ctx.fns.auth.ownerId({ agentId: opts?.agentId });
    if (!user) return [];
    const cache: Map<string, string[]> = ((ctx.state as any).userPlugins ??= new Map());
    const hit = cache.get(user);
    if (hit) return hit;
    const rows = await ctx.fns.procs.db.select({
        sql: "SELECT plugin FROM user_plugins WHERE user_id = ? AND enabled = false ORDER BY plugin",
        params: [user],
    }).catch(() => []) as any[];
    const off = rows.map((row: any) => String(row.plugin));
    cache.set(user, off);
    return off;
}
