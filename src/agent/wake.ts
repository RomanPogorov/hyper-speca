/**
 * Schedules one durable future turn for an agent
 *
 * Create a one-shot durable trigger that appends the supplied prompt to the same agent conversation and queues a turn at an absolute time or after a delay. Use when work should resume once later; use agent.cron for recurrence and agent.watch for a condition.
 * @param opts.id Target agent identifier.
 * @param opts.at Absolute future Unix timestamp in milliseconds; mutually exclusive with inMs.
 * @param opts.inMs Delay in milliseconds, minimum one second; mutually exclusive with at. @minimum 1000
 * @param opts.prompt Prompt inserted into the agent conversation when the trigger fires.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Target agent identifier. */
        id: string;
        /** Absolute future Unix timestamp in milliseconds; mutually exclusive with inMs. */
        at?: number;
        /** Delay in milliseconds, minimum one second; mutually exclusive with at. @minimum 1000 */
        inMs?: number;
        /** Prompt inserted into the agent conversation when the trigger fires. */
        prompt: string;
    },
): Promise<{ id: string; nextAt: number }> {
    const id = String(opts.id ?? "").trim(), prompt = String(opts.prompt ?? "").trim();
    if (!id || !prompt) throw new Error("agent.wake: id and prompt are required");
    if ((opts.at == null) === (opts.inMs == null)) throw new Error("agent.wake: provide exactly one of at or inMs");
    const now = Date.now();
    const nextAt = opts.at != null ? Math.floor(Number(opts.at)) : now + Math.max(1000, Math.floor(Number(opts.inMs)));
    if (!Number.isFinite(nextAt) || nextAt <= now) throw new Error("agent.wake: time must be in the future");
    const made = await ctx.fns.jobs.schedule({ agentId: id, runner: "at", prompt, nextAt });
    return { id: made.id, nextAt };
}
