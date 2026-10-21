/** Deliver wakes for the runtime.  * @param opts.now Timestamp used as the current time.
 * @param opts.limit Maximum records to process.
*/
export default async function (ctx: Context, _session: Session | null, opts?: {
        /** Now used by the operation. */
now?: number;
        /** Maximum number of results to return. */
limit?: number }): Promise<{ delivered: string[] }> {
    const now = Math.floor(opts?.now ?? Date.now());
    const limit = Math.max(1, Math.min(20, opts?.limit ?? 10));
    const due = (await ctx.fns.procs.db.select({
        sql: `SELECT id, wake_at, wake_reason FROM agents
               WHERE wake_at IS NOT NULL AND wake_at <= ? AND archived_at IS NULL
               ORDER BY wake_at ASC LIMIT ?`,
        params: [now, limit],
    })) as any[];
    const delivered: string[] = [];
    for (const row of due) {
        const id = String(row.id);
        const wakeAt = Number(row.wake_at);
        const reason = String(row.wake_reason ?? "Scheduled wake-up");
        // Clearing the alarm and writing its message are ONE transaction: the old
        // order (clear first, append after) lost the wake on a crash in between.
        const result = await ctx.fns.agent.deliver({
            to: id,
            type: "wake_up",
            text: `Wake-up: ${reason}`,
            key: `wake:${wakeAt}`,
            source: "wake-delivered",
            event: { type: "wake_up", reason },
            section: "wake",
            now,
            before: async () => (await ctx.fns.procs.db.run({
                sql: "UPDATE agents SET wake_at = NULL, wake_reason = NULL WHERE id = ? AND wake_at = ?",
                params: [id, wakeAt],
            })).changes > 0,
        });
        if (!result.delivered) {
            // Duplicate (already delivered before a crash) — just make sure the alarm is gone.
            if (result.duplicate) await ctx.fns.procs.db.run({ sql: "UPDATE agents SET wake_at = NULL, wake_reason = NULL WHERE id = ? AND wake_at = ?", params: [id, wakeAt] });
            continue;
        }
        // A parked agent wakes because its quota came back — drop the mark right
        // after the alarm is consumed (as before: alarm cleared, then unpark sees
        // wake_at NULL and restores the person's own earlier reminder). resume is
        // off: the delivery itself already scheduled the run.
        try { await ctx.fns.agent.unpark({ id, reason: "wake", resume: false }); }
        catch (error: any) { console.error(`unpark on wake failed for ${id}:`, error?.message ?? error); }
        const agent = (ctx.state as any).agent?.[id];
        if (agent) {
            agent.wakeAt = null;
            agent.wakeReason = null;
        }
        delivered.push(id);
    }
    if (delivered.length) ctx.fns.agent.wakeWorker({});
    return { delivered };
}
