/**
 * Resolves a comment on a canvas tab once it is acted on — optionally with a short answer — or opens it again.
 * @param opts.id Comment id.
 * @param opts.reply A short answer added before resolving.
 * @param opts.resolved false opens a resolved comment again. @default true
 * @param opts.agentId Agent whose canvas the comment's tab must be on. @default any
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Comment id. */
    id: number;
    /** A short answer added before resolving. */
    reply?: string;
    /** false opens a resolved comment again. @default true */
    resolved?: boolean;
    /** Agent whose canvas the comment's tab must be on. @default any */
    agentId?: string;
}): Promise<types.canvas.Comment> {
    const row = ((await ctx.fns.procs.db.select({ sql: "SELECT id, item_id, parent_id FROM canvas_comments WHERE id = ?", params: [Number(opts.id)] })) as any[])[0];
    if (!row) throw new Error(`canvas.resolveComment: no comment ${opts.id}`);
    const root = Number(row.parent_id ?? row.id);
    const tab = await ctx.fns.canvas.tab({ itemId: Number(row.item_id), agentId: opts.agentId });
    if (opts.reply?.trim()) await ctx.fns.canvas.addComment({ itemId: tab.id, parentId: root, text: opts.reply });
    const on = opts.resolved !== false;
    await ctx.fns.canvas.locked({
        agentId: tab.agentId,
        fn: async () => {
            await ctx.fns.procs.db.run({ sql: "UPDATE canvas_comments SET status = ?, resolved_at = ? WHERE id = ?", params: [on ? "resolved" : "open", on ? Date.now() : null, root] });
            await ctx.fns.procs.db.run({ sql: "UPDATE canvas_items SET updated_at = ? WHERE id = ?", params: [Date.now(), tab.id] });
            return null;
        },
    });
    return (await ctx.fns.canvas.comments({ itemId: tab.id, all: true })).find(c => c.id === root)!;
}
