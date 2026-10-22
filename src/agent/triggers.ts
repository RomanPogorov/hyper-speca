/**
 * Lists durable triggers belonging to an agent
 *
 * List one agent’s reminders (agent.wake), cron schedules (agent.cron) and condition watches (agent.watch) with their lifecycle state, next check time and last run. Use to inspect pending, completed, timed-out or cancelled triggers; cancel with agent.cancelTrigger. The same rows also appear in jobs.list as kind "schedule" with status running instead of active; jobs.list additionally shows background commands.
 * @param opts.id Agent identifier.
 * @param opts.status Lifecycle filter. @default active
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Agent identifier. */
        id: string;
        /** Lifecycle filter. @default active */
        status?: "active" | "completed" | "timed_out" | "cancelled" | "all";
    },
): Promise<any[]> {
    const status = opts.status ?? "active";
    // Old status names over the jobs table: active = running; completed = succeeded; timed_out = timeout.
    const toJob: Record<string, string> = { active: "running", completed: "succeeded", timed_out: "timeout", cancelled: "cancelled" };
    const fromJob: Record<string, string> = { running: "active", succeeded: "completed", timeout: "timed_out", cancelled: "cancelled", failed: "cancelled", lost: "cancelled" };
    const params: any[] = [opts.id];
    let where = "j.agent_id = ? AND j.runner IN ('at','cron','watch')";
    if (status !== "all") { where += " AND j.status = ?"; params.push(toJob[status] ?? status); }
    const rows = await ctx.fns.procs.db.select({
        sql: `SELECT j.*, r.outcome AS last_outcome, r.result AS last_result, r.result_ref AS last_result_ref, r.error AS last_run_error,
                     r.scheduled_at AS last_scheduled_at, r.created_at AS last_run_at
                FROM jobs j
                LEFT JOIN LATERAL (SELECT outcome, result, result_ref, error, scheduled_at, created_at FROM job_runs WHERE job_id = j.id ORDER BY id DESC LIMIT 1) r ON TRUE
               WHERE ${where} ORDER BY j.created_at DESC`,
        params,
    }) as any[];
    return rows.map((row: any) => {
        const spec = typeof row.spec === "string" ? JSON.parse(row.spec) : row.spec ?? {};
        const state = typeof row.state === "string" ? JSON.parse(row.state) : row.state ?? {};
        const num = (v: any) => (v == null ? null : Number(v));
        const config = row.runner === "cron" ? { expression: spec.expression }
            : row.runner === "watch" ? { predicate: spec.predicate, opts: spec.opts ?? {}, everyMs: spec.everyMs, ...(spec.onTimeoutPrompt ? { onTimeoutPrompt: spec.onTimeoutPrompt } : {}) } : {};
        return {
            id: row.id, kind: row.runner, prompt: row.prompt, config, timezone: spec.timezone ?? null,
            mode: row.runner === "cron" ? "repeat" : row.runner === "watch" ? (spec.mode ?? "once") : "once",
            status: fromJob[row.status] ?? row.status,
            nextAt: num(row.next_at), timeoutAt: num(row.deadline_at), lastReady: !!state.lastReady,
            attempts: Number(state.attempts ?? 0), lastError: state.lastError ?? null,
            createdAt: num(row.created_at), finishedAt: num(row.finished_at),
            lastOutcome: row.last_outcome ?? null, lastResult: row.last_result ?? null, lastResultRef: row.last_result_ref ?? null,
            lastRunError: row.last_run_error ?? null, lastScheduledAt: num(row.last_scheduled_at), lastRunAt: num(row.last_run_at),
        };
    });
}
