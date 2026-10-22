/**
 * Reads hyperd's event journal after a sequence number, optionally waiting for the next event
 *
 * Events: started, ready, unhealthy, log_match, exited {code, signal, reason}, restarting, gave_up, stopping, adopted, loaded, changed, removed, daemon_started. Keep the returned seq and pass it as after next time so nothing is missed across restarts.
 * @param opts.after Return events with seq greater than this. @default 0 @minimum 0
 * @param opts.limit Maximum events. @default 500 @minimum 1 @maximum 1000
 * @param opts.waitMs Long-poll: wait up to this long when there is nothing new. @default 0 @minimum 0 @maximum 60000
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Return events with seq greater than this. @default 0 @minimum 0 */
        after?: number;
        /** Maximum events. @default 500 @minimum 1 @maximum 1000 */
        limit?: number;
        /** Long-poll: wait up to this long when there is nothing new. @default 0 @minimum 0 @maximum 60000 */
        waitMs?: number;
    },
): Promise<{ seq: number; events: Array<{ seq: number; at: number; unit: string; run: number; type: string; [key: string]: unknown }> }> {
    const q = new URLSearchParams({ after: String(opts.after ?? 0), limit: String(opts.limit ?? 500), wait: String(opts.waitMs ?? 0) });
    return await ctx.fns.hyperd.call({ path: "/events?" + q, timeoutMs: (opts.waitMs ?? 0) + 10_000 });
}
