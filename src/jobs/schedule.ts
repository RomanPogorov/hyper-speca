/**
 * Creates a durable wake-up, cron schedule or condition watch as a job row
 *
 * The storage behind agent.wake (runner at), agent.cron (runner cron) and agent.watch (runner watch). The row is
 * picked up by jobs.poll at next_at and run by jobs.tickSchedule, which inserts the prompt into the agent's
 * conversation. Ids keep the tr_ prefix so trigger ids returned by the old API stay valid.
 * @param opts.agentId Agent that receives the prompt.
 * @param opts.runner at, cron or watch.
 * @param opts.prompt Prompt inserted when it fires.
 * @param opts.nextAt First due time in ms.
 * @param opts.deadlineAt Watch timeout in ms, or null.
 * @param opts.spec Runner configuration: expression/timezone for cron; predicate/opts/everyMs/mode/onTimeoutPrompt for watch.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Agent that receives the prompt. */
        agentId: string;
        /** at, cron or watch. */
        runner: "at" | "cron" | "watch";
        /** Prompt inserted when it fires. */
        prompt: string;
        /** First due time in ms. */
        nextAt: number;
        /** Watch timeout in ms, or null. */
        deadlineAt?: number | null;
        /** Runner configuration: expression/timezone for cron; predicate/opts/everyMs/mode/onTimeoutPrompt for watch. */
        spec?: Record<string, any>;
    },
): Promise<{ id: string }> {
    const owner = (await ctx.fns.procs.db.select({ sql: "SELECT created_by FROM agents WHERE id = ? AND archived_at IS NULL", params: [opts.agentId] }) as any[])[0];
    if (!owner) throw new Error(`agent not found: ${opts.agentId}`);
    const id = `tr_${Bun.randomUUIDv7()}`;
    const now = Date.now();
    const spec = { title: opts.prompt.slice(0, 120), ...(opts.spec ?? {}) };
    await ctx.fns.procs.db.run({
        sql: `INSERT INTO jobs (id, kind, runner, spec, state, status, owner_id, created_by, agent_id, prompt, execution_id, next_at, created_at, started_at, deadline_at, updated_at)
              VALUES (?, ?, ?, ?::jsonb, '{}'::jsonb, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [id, "schedule", opts.runner, JSON.stringify(spec), owner.created_by ?? null,
            session?.user?.id ?? (session?.agentId ? "agent:" + session.agentId : null), opts.agentId, opts.prompt, id, Math.floor(opts.nextAt), now, now, opts.deadlineAt ?? null, now],
    });
    ctx.fns.agent.wakeWorker({});
    ctx.fns.events.refreshAgentMeta({ agentId: opts.agentId, section: "automation", reason: "trigger-created" });
    return { id };
}
