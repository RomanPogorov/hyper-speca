// The inverse of agent.parkOnUsageLimit.
//
// Three things end a parking: the wake fires (quota is back), the user switches
// the agent to another model or account, or the user cancels the wait. All
// three land here so the mark, the alarm and the pending run stay consistent.
/** Clears a usage-limit parking and optionally resumes the agent. */
/**
 * Remove the usage-limit parking mark from an agent.
 *
 * Cancels the parking wake-up job if it has not fired yet, and — unless told otherwise —
 * reschedules the agent when it still has unread user messages, so the work
 * that was interrupted by the exhausted quota continues.
 *
 * @param opts.id Agent to unpark.
 * @param opts.reason Why the parking ended; recorded in the transcript event.
 * @param opts.resume Whether to reschedule the agent when work is pending.
 * @param opts.now Current time in ms, for testing.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Agent identifier. */
        id: string;
        /** What ended the parking. @default "manual" */
        reason?: "wake" | "manual" | "model-switch";
        /** Reschedule the agent if it has unread user messages. @default true */
        resume?: boolean;
        /** Current timestamp in ms; defaults to Date.now(). */
        now?: number;
    },
): Promise<{ id: string; wasParked: boolean; resumed: boolean }> {
    const id = opts.id;
    const reason = opts.reason ?? "manual";
    const now = opts.now ?? Date.now();
    const resume = opts.resume !== false;

    const updated = await ctx.fns.session.mutateScratchpad({
        id,
        mutate: (scratchpad: Record<string, any>) => {
            const parked = scratchpad.parked ?? null;
            delete scratchpad.parked;
            return parked;
        },
    });
    const parked = updated.result as any;
    if (!parked) return { id, wasParked: false, resumed: false };

    // The parking wake-up is its own job: cancel it unless it is what woke us.
    if (parked.wakeJobId) await ctx.fns.jobs.cancel({ id: String(parked.wakeJobId) });

    // The run cursor never advanced while parked, so "unread" here means the
    // messages that the exhausted quota prevented from being answered.
    let resumed = false;
    if (resume) {
        const pending = ((await ctx.fns.procs.db.select({
            sql: `SELECT 1 AS pending FROM agents a
                   WHERE a.id = ?
                     AND a.archived_at IS NULL
                     AND (SELECT COALESCE(MAX(idx), -1) FROM messages m
                           WHERE m.agent_id = a.id AND m.role = 'user' AND m.excluded_from_cursor = 0) > a.last_processed_msg_idx`,
            params: [id],
        })) as any[])[0];
        if (pending) {
            await ctx.fns.procs.db.run({
                sql: "UPDATE agents SET next_run_at = COALESCE(next_run_at, ?), updated_at = ? WHERE id = ? AND archived_at IS NULL",
                params: [now, now, id],
            });
            resumed = true;
        }
    }

    const live = (ctx.state as any).agent?.[id];
    if (live) live.scratchpad = updated.scratchpad;

    await ctx.fns.session.appendEvent({
        id,
        event: { type: "unparked", reason, provider: parked.provider, account: parked.account, resumed },
    }).catch(() => undefined);
    ctx.fns.events.refreshAgentMeta({ agentId: id, section: "wake", reason: "unparked" });
    if (resumed) { try { ctx.fns.agent.wakeWorker({}); } catch {} }

    return { id, wasParked: true, resumed };
}
