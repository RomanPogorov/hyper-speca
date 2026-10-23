/**
 * Wakes the agent when a condition becomes true: watch for a file to appear, a database query to return rows, a URL to answer or a function to return true
 *
 * Poll a supported condition durably and insert a prompt into the same conversation when it becomes true. once fires once and completes; edge fires on each false-to-true transition and rearms only after the condition becomes false. An optional timeout completes the watch and can insert a separate timeout prompt.
 * @param opts.id Target agent identifier.
 * @param opts.predicate Condition implementation to evaluate.
 * @param opts.opts Predicate-specific options: file.exists { path }; db.rows { sql: one SELECT, params? with ? placeholders } (ready when it returns rows, e.g. "SELECT id FROM jobs WHERE id = ? AND status <> 'running'"); http.ok { url } (ready on a 2xx GET); runtime.fn { name: "module.function", args?, callTimeoutMs? } (the function returns { ready: boolean, result? }).
 * @param opts.prompt Prompt inserted when the condition becomes true.
 * @param opts.everyMs Polling interval in milliseconds. @default 300000 @minimum 5000 @maximum 86400000
 * @param opts.timeoutMs Optional lifetime before the watch completes. @minimum 5000 @maximum 2592000000
 * @param opts.mode Fire once or on every false-to-true transition. @default once
 * @param opts.onTimeoutPrompt Optional prompt inserted if the watch times out.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Target agent identifier. */
        id: string;
        /** Condition implementation to evaluate. */
        predicate: "file.exists" | "db.rows" | "http.ok" | "runtime.fn";
        /** Predicate-specific options: file.exists { path }; db.rows { sql: one SELECT, params? }; http.ok { url }; runtime.fn { name: "module.function", args?, callTimeoutMs? }. */
        opts: Record<string, any>;
        /** Prompt inserted when the condition becomes true. */
        prompt: string;
        /** Polling interval in milliseconds. @default 300000 @minimum 5000 @maximum 86400000 */
        everyMs?: number;
        /** Optional lifetime before the watch completes. @minimum 5000 @maximum 2592000000 */
        timeoutMs?: number;
        /** Fire once or on every false-to-true transition. @default once */
        mode?: "once" | "edge";
        /** Optional prompt inserted if the watch times out. */
        onTimeoutPrompt?: string;
    },
): Promise<{ id: string; nextAt: number; hint: string; timeoutAt: number | null }> {
    const id = String(opts.id ?? "").trim();
    const prompt = String(opts.prompt ?? "").trim();
    if (!id || !prompt) throw new Error("agent.watch: id and prompt are required");
    if (!["file.exists", "db.rows", "http.ok", "runtime.fn"].includes(opts.predicate)) throw new Error("agent.watch: unsupported predicate");
    const exists = (await ctx.fns.procs.db.select({ sql: "SELECT id FROM agents WHERE id=? AND archived_at IS NULL", params: [id] }))[0];
    if (!exists) throw new Error(`agent not found: ${id}`);

    // Validate predicate configuration and surface network/SQL/function errors
    // before persisting. A valid false result is expected and still creates the watch.
    await ctx.fns.agent.watchPredicate({ predicate: opts.predicate, opts: opts.opts ?? {} });

    const everyMs = Math.max(5000, Math.min(86400000, Math.floor(Number(opts.everyMs ?? 300000))));
    const now = Date.now();
    const timeoutAt = opts.timeoutMs == null ? null : now + Math.max(everyMs, Math.min(2592000000, Math.floor(Number(opts.timeoutMs))));
    const mode = opts.mode ?? "once";
    const made = await ctx.fns.jobs.schedule({
        agentId: id, runner: "watch", prompt, nextAt: now, deadlineAt: timeoutAt,
        spec: { predicate: opts.predicate, opts: opts.opts ?? {}, everyMs, mode, ...(opts.onTimeoutPrompt ? { onTimeoutPrompt: String(opts.onTimeoutPrompt) } : {}) },
    });
    return { id: made.id, nextAt: now, timeoutAt, hint: "List: ctx.fns.jobs.list({}); cancel: ctx.fns.jobs.cancel({ id }). The prompt arrives as a message when it fires: end your turn, do not sleep or poll." };
}
