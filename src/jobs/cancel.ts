/**
 * Cancels any job by id: a background command, a wake-up, a cron schedule, a watch or an event subscription
 *
 * The one way to stop something listed by jobs.list. A background command gets Ctrl-C, then is killed after a few
 * seconds; a wake-up, schedule or watch simply never fires again; a subscription is detached and its external
 * producer stopped when nobody else uses it. Cancel is silent: no completion message follows; the returned job is
 * the result (status "cancelled"; for a killed command result.exitCode is null).
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
        const backend = job.spec?.backend;
        const killed = await ctx.fns.jobs.bashKill({ jobId: job.id, host: job.host, backend });
        if (killed.unreachable) throw new Error(`jobs.cancel: host ${job.host} unreachable; cancel is recorded and will be retried`);
        const probe = await ctx.fns.jobs.bashProbe({ jobId: job.id, host: job.host, backend });
        const spec = { secrets: ((await ctx.fns.procs.db.select({ sql: "SELECT spec FROM jobs WHERE id = ?", params: [job.id] })) as any[])[0]?.spec?.secrets };
        await ctx.fns.jobs.finish({ id: job.id, status: "cancelled", reason: "cancelled", exitCode: probe.exitCode, tail: await ctx.fns.jobs.redact({ spec, text: probe.tail }), bytes: probe.bytes, notify: false });
    } else if (job.runner === "attach") {
        await ctx.fns.jobs.finish({ id: job.id, status: "cancelled", reason: "cancelled", notify: false });
        await ctx.fns.procs.db.run({ sql: "UPDATE attachment_deliveries SET status = 'failed', claim_token = NULL, claimed_at = NULL, last_error = 'attachment detached', updated_at = ? WHERE attachment_id = ? AND status IN ('pending', 'delivering')", params: [now, job.id] });
        if (job.spec?.source) await ctx.fns.agent.stopUnusedAttachments({ source: String(job.spec.source) });
    } else {
        await ctx.fns.jobs.finish({ id: job.id, status: "cancelled", reason: "cancelled", notify: false });
        ctx.fns.agent.wakeWorker({});
    }
    return await ctx.fns.jobs.get({ id: job.id });
}
