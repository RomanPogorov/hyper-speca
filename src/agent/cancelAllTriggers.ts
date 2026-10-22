/**
 * Cancels all pending durable triggers for an agent
 *
 * Cancel every active or currently checking time, cron and condition trigger owned by one agent. Use when stopping all deferred autonomous work for that agent.
 * @param opts.id Agent whose triggers should be cancelled.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Agent whose triggers should be cancelled. */
        id: string;
    },
): Promise<{ cancelled: number }> {
    const now = Date.now();
    const r = await ctx.fns.procs.db.run({
        sql: "UPDATE jobs SET status = 'cancelled', outcome_reason = 'cancelled', cancel_requested_at = ?, next_at = NULL, finished_at = ?, updated_at = ? WHERE agent_id = ? AND runner IN ('at','cron','watch') AND status = 'running'",
        params: [now, now, now, opts.id],
    });
    ctx.fns.agent.wakeWorker({});
    ctx.fns.events.refreshAgentMeta({ agentId: opts.id, section: "automation", reason: "trigger-cancel" });
    return { cancelled: r.changes };
}
