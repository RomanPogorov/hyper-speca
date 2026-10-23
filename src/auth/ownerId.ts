/**
 * Returns whose personal things (keys, connected accounts, subscriptions, settings, plugins) this call uses,
 * or "" when it has no owner (an open instance without users, or background work of nobody).
 *
 * Order: the signed-in person of the request → the creator of the agent the call runs for (a turn, a job,
 * a wake: `session.agentId` or `opts.agentId`) → the only user of a single-user instance. Unlike
 * auth.actorId this is used for reading credentials, so a call never falls back to "somebody's".
 * @param opts.agentId Agent the call runs for, when the session does not say it.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts?: {
        /** Agent the call runs for, when the session does not say it. */
        agentId?: string;
    },
): Promise<string> {
    const fromSession = (session as any)?.user?.id;
    if (fromSession) return String(fromSession);
    const agentId = opts?.agentId ?? session?.agentId ?? (session as any)?.agent?.id;
    if (agentId) {
        const live = (ctx.state as any).agent?.[agentId];
        if (live?.createdBy) return String(live.createdBy);
        const rows = await ctx.fns.procs.db.select({ sql: "SELECT created_by FROM agents WHERE id = ?", params: [agentId] }).catch(() => []) as any[];
        if (rows[0]?.created_by) return String(rows[0].created_by);
    }
    // One person on the instance: everything is theirs. Cached briefly — this runs on every secret read.
    const cache = ((ctx.state as any).authOwner ??= { at: 0, only: "" });
    if (Date.now() - cache.at > 5_000) {
        const users = await ctx.fns.auth.listUsers({}).catch(() => [] as any[]);
        cache.only = users.length === 1 ? String(users[0]!.id) : "";
        cache.at = Date.now();
    }
    return cache.only;
}
