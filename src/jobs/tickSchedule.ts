/**
 * Runs one due wake-up, cron or watch job: fires its prompt, reschedules or finishes it
 *
 * Called by jobs.poll for leased rows with runner at, cron or watch (made by agent.wake, agent.cron, agent.watch).
 * at fires once; cron fires and moves to its next occurrence; watch evaluates its predicate (once or edge mode,
 * optional timeout with onTimeoutPrompt). The prompt message, the job's new state and its job_runs audit row commit
 * in one transaction through agent.deliver, keyed by job id + scheduled time, so a retry never prompts twice and a
 * cancel that commits first wins. Predicate errors back off from 1 to 15 minutes.
 * @param opts.row The leased jobs row.
 * @param opts.token Lease token held by this poll pass.
 * @param opts.now Evaluation timestamp in ms.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** The leased jobs row. */
        row: Record<string, any>;
        /** Lease token held by this poll pass. */
        token: string;
        /** Evaluation timestamp in ms. */
        now: number;
    },
): Promise<{ outcome: "fired" | "waiting" | "rearmed" | "timed_out" | "error" | "cancelled" }> {
    const { row, token, now } = opts;
    const json = (v: any) => (typeof v === "string" ? JSON.parse(v) : v ?? {});
    const spec = json(row.spec);
    const state = json(row.state);
    const id = String(row.id);
    // A pass that failed after delivering keeps its occurrence in state (jobs.poll), so the retry
    // reuses the same delivery key and is recognised as a duplicate instead of prompting again.
    const scheduledAt = Number(state.occurrence ?? row.next_at ?? now);
    const attempts = Number(state.attempts ?? 0);
    const interval = Math.max(5000, Number(spec.everyMs ?? 300_000));

    if (row.cancel_requested_at != null) {
        await ctx.fns.procs.db.run({ sql: "UPDATE jobs SET status = 'cancelled', outcome_reason = 'cancelled', next_at = NULL, lease_token = NULL, finished_at = ?, updated_at = ? WHERE id = ? AND lease_token = ?", params: [now, now, id, token] });
        return { outcome: "cancelled" };
    }

    type Outcome = "fired" | "waiting" | "rearmed" | "timed_out" | "error";
    let outcome: Outcome = "waiting";
    let status: "running" | "succeeded" | "timeout" = "running";
    let nextAt: number | null = null;
    let prompt: string | null = null;
    let result: any = null;
    let error: string | null = null;
    let lastReady = !!state.lastReady;
    try {
        if (row.runner === "at") {
            outcome = "fired"; prompt = row.prompt; status = "succeeded";
        } else if (row.runner === "cron") {
            outcome = "fired"; prompt = row.prompt;
            nextAt = await ctx.fns.agent.nextCronAt({ expression: String(spec.expression), timezone: String(spec.timezone ?? "UTC"), after: now });
        } else if (row.deadline_at != null && now >= Number(row.deadline_at)) {
            outcome = "timed_out"; status = "timeout";
            prompt = spec.onTimeoutPrompt ? String(spec.onTimeoutPrompt) : null;
        } else {
            const checked = await ctx.fns.agent.watchPredicate({ predicate: String(spec.predicate), opts: spec.opts ?? {} });
            result = checked.result ?? null;
            const ready = !!checked.ready;
            if (spec.mode !== "edge" && ready) { outcome = "fired"; prompt = row.prompt; status = "succeeded"; lastReady = true; }
            else if (spec.mode === "edge" && ready && !lastReady) { outcome = "fired"; prompt = row.prompt; nextAt = now + interval; lastReady = true; }
            else { outcome = !ready && lastReady ? "rearmed" : "waiting"; lastReady = ready; nextAt = now + interval; }
        }
    } catch (e: any) {
        outcome = "error"; status = "running"; prompt = null;
        error = String(e?.message ?? e).slice(0, 1000);
        nextAt = now + Math.min(15 * 60_000, Math.max(60_000, 60_000 * 2 ** Math.min(attempts, 4)));
    }

    // The audit keeps a bounded preview; a large predicate result is stored as an immutable file.
    let resultJson: string;
    let resultRef: types.agent.ResultRef | undefined;
    let resultPreview: string | undefined;
    try {
        const full = JSON.stringify(result ?? null) ?? "null";
        const prepared = await ctx.fns.resultStore.prepare({ ownerAgentId: String(row.agent_id), kind: "trigger:" + id, text: full, inlineLimit: 16_000 });
        resultRef = prepared.ref;
        resultPreview = prepared.preview;
        resultJson = prepared.truncated
            ? JSON.stringify({ truncated: true, originalChars: prepared.originalChars, preview: prepared.preview, ...(prepared.storageError !== undefined ? { storageError: "Full result unavailable: storage failed" } : {}) })
            : full;
    } catch {
        resultJson = JSON.stringify({ truncated: true, preview: "[unserializable result]", storageError: "Full result unavailable: serialization failed" });
    }

    const newState = JSON.stringify({ ...state, occurrence: undefined, lastReady, attempts: attempts + 1, lastError: error, lastOutcome: outcome, lastRunAt: now });
    const reason = status === "succeeded" ? "fired" : status === "timeout" ? "timeout" : null;
    const finalize = async () => (await ctx.fns.procs.db.run({
        sql: `UPDATE jobs SET status = ?, outcome_reason = COALESCE(?, outcome_reason), next_at = ?, state = ?::jsonb, lease_token = NULL, lease_expires_at = NULL,
                     finished_at = CASE WHEN ? <> 'running' THEN ? ELSE finished_at END, updated_at = ?
               WHERE id = ? AND status = 'running' AND lease_token = ?`,
        params: [status, reason, status === "running" ? nextAt : null, newState, status, now, now, id, token],
    })).changes > 0;
    const audit = async () => {
        await ctx.fns.procs.db.run({
            sql: "INSERT INTO job_runs (job_id, scheduled_at, outcome, result, result_ref, error, created_at) VALUES (?, ?, ?, ?::jsonb, ?::jsonb, ?, ?) ON CONFLICT DO NOTHING",
            params: [id, scheduledAt, outcome, resultJson, resultRef ? JSON.stringify(resultRef) : null, error, now],
        });
    };

    if (!prompt) {
        const ok = await ctx.fns.procs.db.transaction({ fn: async () => { if (!(await finalize())) return false; await audit(); return true; } });
        if (ok) ctx.fns.events.refreshAgentMeta({ agentId: String(row.agent_id), section: "automation", reason: "trigger-checked" });
        return { outcome: ok ? outcome : "cancelled" };
    }

    const text = String(prompt) + (resultRef ? `\n\nPredicate result preview: ${resultPreview ?? ""}\nFull result: await ctx.fns.agent.readResult({ id: "${resultRef.id}", offset: 0, limit: 4000 })` : "");
    const delivered = await ctx.fns.agent.deliver({
        to: String(row.agent_id),
        type: "trigger",
        text,
        key: `trigger:${id}:${scheduledAt}`,
        source: "trigger-delivered",
        resultRef,
        event: { type: "wake_up", reason: String(prompt), triggerId: id },
        section: "wake",
        now,
        // Cancel committed first → status is no longer running → no prompt.
        before: finalize,
        after: audit,
    });
    if (delivered.duplicate) {
        // Delivered by an earlier pass that crashed before finalizing: finish the bookkeeping only.
        await ctx.fns.procs.db.transaction({ fn: async () => { if (await finalize()) await audit(); } });
        return { outcome };
    }
    return { outcome: delivered.delivered ? outcome : "cancelled" };
}
