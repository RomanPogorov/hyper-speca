/**
 * Undoes the last edit of a canvas tab's draft: the tab goes back to the edit before it, or to its last version.
 *
 * The undone edit is kept for canvas.redo until the next new edit. The agent's whole answer is one step (see
 * canvas.write). Returns null in `undone` when there was nothing to undo.
 * @param opts.itemId Tab to step back.
 * @param opts.agentId Agent whose canvas the tab must be on. @default any
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Tab to step back. */
    itemId: number;
    /** Agent whose canvas the tab must be on. @default any */
    agentId?: string;
}): Promise<{ item: types.canvas.Item; undone: { n: number; note: string | null } | null }> {
    const tab = await ctx.fns.canvas.tab({ itemId: opts.itemId, agentId: opts.agentId });
    const undone = await ctx.fns.canvas.locked({
        agentId: tab.agentId,
        fn: async () => {
            const db = ctx.fns.procs.db;
            const last = ((await db.select({ sql: "SELECT n, note FROM canvas_edits WHERE item_id = ? AND undone_at IS NULL AND dropped_at IS NULL ORDER BY n DESC LIMIT 1", params: [tab.id] })) as any[])[0];
            if (!last) return null;
            await db.run({ sql: "UPDATE canvas_edits SET undone_at = ? WHERE item_id = ? AND n = ?", params: [Date.now(), tab.id, last.n] });
            await ctx.fns.canvas.settle({ itemId: tab.id });
            return { n: Number(last.n), note: last.note ?? null };
        },
    });
    return { item: await ctx.fns.canvas.tab({ itemId: tab.id }), undone };
}
