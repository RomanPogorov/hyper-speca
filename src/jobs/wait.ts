/**
 * Waits up to timeoutMs for a background job to end and returns it
 *
 * Use when the result of a running job is needed now, within a bounded time (the bash tool's background.afterMs
 * waits this way). Returns { done: true, job } as soon as the job is no longer running, or done: false when
 * timeoutMs passes — the job keeps running then and reports as usual. For bash and attached jobs it probes the
 * process itself, so a job that ends while you wait is recorded here without a completion message (the caller
 * already has its result). Timers, wake-ups and schedules are only observed. Do not call it in a loop to poll:
 * end the turn and let the completion message arrive.
 * @param opts.id Id of the job to wait for.
 * @param opts.timeoutMs How long to wait at most, in milliseconds. @default 30000 @minimum 0 @maximum 600000
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Id of the job to wait for. */
        id: string;
        /** How long to wait at most, in milliseconds. @default 30000 @minimum 0 @maximum 600000 */
        timeoutMs?: number;
    },
): Promise<{ done: boolean; job: types.jobs.Job }> {
    const end = Date.now() + Math.max(0, Math.min(600_000, Math.floor(opts.timeoutMs ?? 30_000)));
    for (let step = 100; ; step = Math.min(1000, step * 2)) {
        const job = await ctx.fns.jobs.get({ id: opts.id });
        if (job.status !== "running") return { done: true, job };
        if (job.runner === "bash" || job.runner === "attached") {
            const attached = job.runner === "attached";
            const probe = await ctx.fns.jobs.bashProbe({
                jobId: job.id,
                host: attached ? null : job.host,
                backend: job.spec?.backend,
                ...(attached ? { alive: ((ctx.state as any).attachedJobs as Map<string, unknown> | undefined)?.has(job.id) ?? false } : {}),
            });
            if (probe.state === "done" || probe.state === "gone") {
                const row = ((await ctx.fns.procs.db.select({ sql: "SELECT spec, cancel_requested_at FROM jobs WHERE id = ?", params: [job.id] })) as any[])[0];
                const cancelled = row?.cancel_requested_at != null;
                const status = cancelled ? "cancelled" : probe.state === "gone" ? "lost" : probe.exitCode === 0 ? "succeeded" : "failed";
                const reason = cancelled ? "cancelled" : probe.state === "gone" ? "gone" : "exit";
                const tail = await ctx.fns.jobs.redact({ spec: row?.spec ?? {}, text: probe.tail });
                await ctx.fns.jobs.finish({ id: job.id, status, reason, exitCode: probe.exitCode, tail, bytes: probe.bytes, notify: false });
                return { done: true, job: await ctx.fns.jobs.get({ id: job.id }) };
            }
        }
        const left = end - Date.now();
        if (left <= 0) return { done: false, job };
        await Bun.sleep(Math.min(step, left));
    }
}
