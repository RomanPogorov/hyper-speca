// The prose an agent is streaming right now, for any interface. It lives in
// memory only (persisting every token would hammer Postgres); the final
// assistant event stays the durable source. agent.run signals each change on
// the bus topic `agent:<id>:stream`, so a UI re-reads this instead of polling.
/**
 * Read the text the agent is streaming in its current model call.
 * @param opts.id Agent identifier.
 * @returns The partial text with its revision, or null when nothing streams.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Agent identifier. */
    id: string;
}): { text: string; revision: number; startedAt: number } | null {
    const stream = (ctx.state as any).agent?.[opts.id]?.scratchpad?.mobileStream;
    if (!stream || typeof stream.text !== 'string' || !stream.text.length) return null;
    return { text: stream.text, revision: Number(stream.revision ?? 0), startedAt: Number(stream.startedAt ?? Date.now()) };
}
