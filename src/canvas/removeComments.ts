/**
 * Deletes comments from a canvas tab with their answers — one author's own only (a person removes what they wrote).
 *
 * Resolving keeps a comment for "show resolved"; removing is for the ones written by mistake.
 * @param opts.itemId Tab the comments are on.
 * @param opts.author Whose comments: only theirs are removed.
 * @param opts.ids These comments. @default every comment of the author on the tab
 * @param opts.agentId Agent whose canvas the tab must be on. @default any
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Tab the comments are on. */
    itemId: number;
    /** Whose comments: only theirs are removed. */
    author: string;
    /** These comments. @default every comment of the author on the tab */
    ids?: number[];
    /** Agent whose canvas the tab must be on. @default any */
    agentId?: string;
}): Promise<{ removed: number }> {
    const tab = await ctx.fns.canvas.tab({ itemId: opts.itemId, agentId: opts.agentId });
    const author = String(opts.author ?? "");
    if (!author) throw new Error("canvas.removeComments: author is required");
    const want = opts.ids ? new Set(opts.ids.map(Number)) : null;
    const rows = (await ctx.fns.procs.db.select({ sql: "SELECT id, parent_id FROM canvas_comments WHERE item_id = ? AND author = ?", params: [tab.id, author] })) as any[];
    const ids = rows.map(r => Number(r.id)).filter(id => !want || want.has(id));
    if (!ids.length) return { removed: 0 };
    await ctx.fns.canvas.locked({
        agentId: tab.agentId,
        fn: async () => {
            for (const id of ids) {
                await ctx.fns.procs.db.run({ sql: "DELETE FROM canvas_comments WHERE item_id = ? AND (id = ? OR parent_id = ?)", params: [tab.id, id, id] });
            }
            await ctx.fns.procs.db.run({ sql: "UPDATE canvas_items SET updated_at = ? WHERE id = ?", params: [Date.now(), tab.id] });
            return null;
        },
    });
    return { removed: ids.length };
}
