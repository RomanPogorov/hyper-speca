/**
 * Cancels one durable agent trigger
 *
 * Cancel one pending time, cron or condition trigger owned by the specified agent. Cancellation is idempotent and a trigger already being checked will not deliver after its claim is invalidated.
 * @param opts.id Owning agent identifier.
 * @param opts.triggerId Trigger identifier returned by wake, cron or watch.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Owning agent identifier. */
        id: string;
        /** Trigger identifier returned by wake, cron or watch. */
        triggerId: string;
    },
): Promise<{ cancelled: boolean }> {
    const now = Date.now();
    const r = await ctx.fns.procs.db.run({
        sql: "UPDATE jobs SET status = 'cancelled', outcome_reason = 'cancelled', cancel_requested_at = ?, next_at = NULL, finished_at = ?, updated_at = ? WHERE id = ? AND agent_id = ? AND runner IN ('at','cron','watch') AND status = 'running'",
        params: [now, now, now, opts.triggerId, opts.id],
    });
    ctx.fns.agent.wakeWorker({});
    ctx.fns.events.refreshAgentMeta({ agentId: opts.id, section: "automation", reason: "trigger-cancel" });
    return { cancelled: r.changes > 0 };
}
