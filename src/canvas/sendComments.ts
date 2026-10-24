/**
 * Marks a canvas tab's waiting comments as sent and returns them as one message for the agent — each with where it
 * points and the words it quotes — so the interface delivers it as the person's next message.
 *
 * Returns an empty text when nothing waits. The comments stay open until the agent resolves them.
 * @param opts.itemId Tab whose comments to send.
 * @param opts.ids Only these comments. @default every one that waits
 * @param opts.agentId Agent whose canvas the tab must be on. @default any
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Tab whose comments to send. */
    itemId: number;
    /** Only these comments. @default every one that waits */
    ids?: number[];
    /** Agent whose canvas the tab must be on. @default any */
    agentId?: string;
}): Promise<{ text: string; ids: number[] }> {
    const tab = await ctx.fns.canvas.tab({ itemId: opts.itemId, agentId: opts.agentId });
    const want = opts.ids?.length ? new Set(opts.ids.map(Number)) : null;
    const waiting = (await ctx.fns.canvas.comments({ itemId: tab.id })).filter(c => c.sentAt == null && (!want || want.has(c.id)));
    if (!waiting.length) return { text: "", ids: [] };
    await ctx.fns.canvas.locked({
        agentId: tab.agentId,
        fn: async () => {
            const now = Date.now();
            for (const c of waiting) await ctx.fns.procs.db.run({ sql: "UPDATE canvas_comments SET sent_at = ? WHERE id = ?", params: [now, c.id] });
            await ctx.fns.procs.db.run({ sql: "UPDATE canvas_items SET updated_at = ? WHERE id = ?", params: [now, tab.id] });
            return null;
        },
    });
    const where = (t: Record<string, any> | null) => !t ? "" : t.file ? ` [${t.file}${t.tid != null ? `#${t.tid}` : ""}]` : t.path ? ` [${t.path}]` : "";
    const lines = waiting.map((c, i) => `${i + 1}. (comment ${c.id})${where(c.target)}${c.quote ? ` «${c.quote.slice(0, 160)}»` : ""}: ${c.text}`);
    const text = `Comments on the canvas tab «${tab.title}» (tab ${tab.id}, ${tab.kind}):\n${lines.join("\n")}\n\nAct on them, then resolve each with canvas.resolveComment (a short reply if useful).`;
    return { text, ids: waiting.map(c => c.id) };
}
