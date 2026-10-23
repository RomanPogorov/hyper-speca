/**
 * Cancels every running job of one agent: background commands, wake-ups, schedules, watches and subscriptions
 *
 * Called when an agent is archived, so nothing keeps running or waking an agent nobody looks at. Each job goes
 * through jobs.cancel (commands are killed, subscriptions detached). Cancelled jobs send no completion message.
 * Stopping an agent's turn does not call this — its jobs keep running and report back.
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
    const rows = await ctx.fns.procs.db.select({ sql: "SELECT id FROM jobs WHERE agent_id = ? AND status = 'running'", params: [opts.agentId] }) as any[];
    const cancelled: string[] = [];
    const failed: string[] = [];
    for (const row of rows) {
        const id = String(row.id);
        try {
            await ctx.fns.jobs.cancel({ id });
            cancelled.push(id);
        } catch (error: any) {
            // e.g. an unreachable SSH host: the cancel request is recorded and retried by jobs.poll.
            failed.push(id);
            await ctx.fns.procs.log.warn({ event: "jobs.cancelAgent.failed", msg: String(error?.message ?? error), jobId: id });
        }
    }
    return { cancelled, failed };
}
