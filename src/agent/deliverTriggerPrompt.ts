/**
 * Delivers one claimed trigger prompt into its agent conversation
 *
 * Append a trigger-generated user prompt and schedule the target agent through agent.deliver: the claim recheck (row lock), message, UI event, replay receipt and schedule commit in one transaction, so a cancel can no longer slip between the check and the insert, and a retry of the same occurrence after a crash is a duplicate instead of a second prompt.
 * @param opts.triggerId Claimed trigger identifier.
 * @param opts.claimToken Unique token proving ownership of the current claim.
 * @param opts.prompt Prompt to insert.
 * @param opts.now Delivery timestamp in milliseconds.
 * @param opts.resultRef Durable predicate result reference, attached only after successful storage.
 * @param opts.resultPreview Bounded predicate preview accompanying a stored reference.
 * @param opts.occurrence Scheduled time of this firing; with the trigger id it forms the delivery key. Defaults to opts.now.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Claimed trigger identifier. */
        triggerId: string;
        /** Unique token proving ownership of the current claim. */
        claimToken: string;
        /** Prompt to insert. */
        prompt: string;
        /** Delivery timestamp in milliseconds. */
        now: number;
        /** Durable predicate result reference, attached only after successful storage. */
        resultRef?: types.agent.ResultRef;
        /** Bounded predicate preview accompanying a stored reference. */
        resultPreview?: string;
        /** Scheduled time of this firing; with the trigger id it forms the delivery key. Defaults to opts.now. */
        occurrence?: number;
    },
): Promise<boolean> {
    const owner = (await ctx.fns.procs.db.select({ sql: "SELECT agent_id FROM agent_triggers WHERE id=? AND status='checking' AND claim_token=?", params: [opts.triggerId, opts.claimToken] }))[0] as any;
    if (!owner) return false;
    const agentId = String(owner.agent_id);
    const prompt = String(opts.prompt);
    const text = prompt + (opts.resultRef ? `\n\nPredicate result preview: ${opts.resultPreview ?? ""}\nFull result: await ctx.fns.agent.readResult({ id: "${opts.resultRef.id}", offset: 0, limit: 4000 })` : "");
    const result = await ctx.fns.agent.deliver({
        to: agentId,
        type: "trigger",
        text,
        key: `trigger:${opts.triggerId}:${Math.floor(opts.occurrence ?? opts.now)}`,
        source: "trigger-delivered",
        resultRef: opts.resultRef,
        event: { type: "wake_up", reason: prompt, triggerId: opts.triggerId },
        section: "wake",
        now: opts.now,
        // Recheck the claim under a row lock in the delivery transaction: a cancel
        // that commits first wins, one that comes later waits for this delivery.
        before: async () => ((await ctx.fns.procs.db.select({ sql: "SELECT 1 FROM agent_triggers WHERE id=? AND status='checking' AND claim_token=? FOR UPDATE", params: [opts.triggerId, opts.claimToken] })) as any[]).length > 0,
    });
    return result.delivered || result.duplicate;
}
