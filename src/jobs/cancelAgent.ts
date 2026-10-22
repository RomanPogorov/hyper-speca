/**
 * Cancels every running job of one agent: background commands, timers, wake-ups, schedules, watches and subscriptions
 *
 * Called when an agent is archived, so nothing keeps running or waking an agent nobody looks at. Background bash is
 * killed through jobs.cancel; timers and schedules are marked cancelled; event subscriptions are cancelled and an
 * external producer no longer used by anyone is stopped. Cancelled jobs send no completion message. Stopping an
 * agent's turn does not call this — its jobs keep running and report back.
 * @param opts.agentId Agent whose jobs are cancelled.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Agent whose jobs are cancelled. */
        agentId: string;
    },
): Promise<{ cancelled: string[]; failed: string[] }> {
    const rows = await ctx.fns.procs.db.select({ sql: "SELECT id, runner, spec->>'source' AS source FROM jobs WHERE agent_id = ? AND status = 'running'", params: [opts.agentId] }) as any[];
    const cancelled: string[] = [];
    const failed: string[] = [];
    const sources = new Set<string>();
    const now = Date.now();
    for (const row of rows) {
        const id = String(row.id);
        try {
            if (row.runner === "bash" || row.runner === "attached" || row.runner === "sleep") {
                await ctx.fns.jobs.cancel({ id });
            } else {
                await ctx.fns.procs.db.run({
                    sql: "UPDATE jobs SET status = 'cancelled', outcome_reason = 'archived', cancel_requested_at = ?, next_at = NULL, finished_at = ?, updated_at = ? WHERE id = ? AND status = 'running'",
                    params: [now, now, now, id],
                });
                if (row.runner === "attach" && row.source) sources.add(String(row.source));
            }
            cancelled.push(id);
        } catch (error: any) {
            // e.g. an unreachable SSH host: the cancel request is recorded and retried by jobs.poll.
            failed.push(id);
            await ctx.fns.procs.log.warn({ event: "jobs.cancelAgent.failed", msg: String(error?.message ?? error), jobId: id });
        }
    }
    for (const source of sources) await ctx.fns.agent.stopUnusedAttachments({ source });
    return { cancelled, failed };
}
