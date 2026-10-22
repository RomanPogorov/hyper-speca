/**
 * Schedules recurring durable turns for an agent using cron
 *
 * Create a recurring trigger that inserts a prompt into the same agent conversation on a five-field cron schedule. Timezone is explicit so daylight-saving behavior follows the named location. Missed occurrences collapse to one immediate catch-up, then the next future occurrence is calculated.
 * @param opts.id Target agent identifier.
 * @param opts.expression Five-field cron expression.
 * @param opts.timezone IANA timezone such as Europe/Lisbon.
 * @param opts.prompt Prompt inserted on every occurrence.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Target agent identifier. */
        id: string;
        /** Five-field cron expression. */
        expression: string;
        /** IANA timezone such as Europe/Lisbon. */
        timezone: string;
        /** Prompt inserted on every occurrence. */
        prompt: string;
    },
): Promise<{ id: string; nextAt: number; hint: string }> {
    const id = String(opts.id ?? "").trim(), prompt = String(opts.prompt ?? "").trim();
    const expression = String(opts.expression ?? "").trim(), timezone = String(opts.timezone ?? "").trim();
    if (!id || !prompt || !expression || !timezone) throw new Error("agent.cron: id, expression, timezone and prompt are required");
    const nextAt = await ctx.fns.agent.nextCronAt({ expression, timezone, after: Date.now() });
    const made = await ctx.fns.jobs.schedule({ agentId: id, runner: "cron", prompt, nextAt, spec: { expression, timezone } });
    return { id: made.id, nextAt, hint: "List: ctx.fns.agent.triggers({ id }) or ctx.fns.jobs.list({}); cancel: ctx.fns.agent.cancelTrigger({ id, triggerId }). The prompt arrives as a message when it fires: end your turn, do not sleep or poll." };
}
