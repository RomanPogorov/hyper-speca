/**
 * Stops a running background job; the agent is not woken for a job it cancelled itself
 *
 * Use when a background command is no longer needed or hangs. Sends Ctrl-C to its tmux session, kills it after a few
 * seconds, and records the job as cancelled. Timers (runner sleep) are simply dropped.
 * @param opts.id Job id.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Job id. */
        id: string;
    },
): Promise<types.jobs.Job> {
    const job = await ctx.fns.jobs.get({ id: opts.id });
    if (job.status !== "running") return job;
    const now = Date.now();
    await ctx.fns.procs.db.run({ sql: "UPDATE jobs SET cancel_requested_at = COALESCE(cancel_requested_at, ?), updated_at = ? WHERE id = ?", params: [now, now, job.id] });
    if (job.runner === "attached") {
        const handle = ((ctx.state as any).attachedJobs as Map<string, { kill: () => void }> | undefined)?.get(job.id);
        handle?.kill();
        await Bun.sleep(200);
        const probe = await ctx.fns.jobs.bashProbe({ jobId: job.id, host: null, alive: false });
        await ctx.fns.jobs.finish({ id: job.id, status: "cancelled", reason: "cancelled", exitCode: probe.exitCode, tail: probe.tail, bytes: probe.bytes, notify: false });
    } else if (job.runner === "bash") {
        const killed = await ctx.fns.jobs.bashKill({ jobId: job.id, host: job.host });
        if (killed.unreachable) throw new Error(`jobs.cancel: host ${job.host} unreachable; cancel is recorded and will be retried`);
        const probe = await ctx.fns.jobs.bashProbe({ jobId: job.id, host: job.host });
        const spec = { secrets: ((await ctx.fns.procs.db.select({ sql: "SELECT spec FROM jobs WHERE id = ?", params: [job.id] })) as any[])[0]?.spec?.secrets };
        await ctx.fns.jobs.finish({ id: job.id, status: "cancelled", reason: "cancelled", exitCode: probe.exitCode, tail: await ctx.fns.jobs.redact({ spec, text: probe.tail }), bytes: probe.bytes, notify: false });
    } else {
        await ctx.fns.jobs.finish({ id: job.id, status: "cancelled", reason: "cancelled", notify: false });
    }
    return await ctx.fns.jobs.get({ id: job.id });
}
