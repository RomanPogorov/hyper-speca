/**
 * Rehydrate at boot only the agents that were working or queued: run_state not idle, or a next_run_at set.
 * Every other agent is loaded on first use (worker claim, chat render, message delivery all fall back to
 * session.load), so boot no longer reads ~1000 transcripts — most never opened again — taking a minute
 * and gigabytes of memory.
 */
export default async function (ctx: Context, _session: Session | null, _opts?: {}): Promise<{ loaded: number }> {
    const ids = (await ctx.fns.procs.db.select({
        sql: "SELECT id FROM agents WHERE archived_at IS NULL AND (COALESCE(run_state, 'idle') <> 'idle' OR next_run_at IS NOT NULL) ORDER BY updated_at DESC",
    })) as { id: string }[];
    (ctx.state as any).agent ??= {};
    let n = 0;
    for (const { id } of ids) {
        const agent = await ctx.fns.session.load({ id });
        if (agent) {
            (ctx.state as any).agent[id] = agent;
            n++;
        }
    }
    return { loaded: n };
}
