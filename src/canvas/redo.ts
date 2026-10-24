/**
 * Redoes the edit of a canvas tab's draft undone last — if nothing new was written since.
 *
 * Returns null in `redone` when there is nothing to redo.
 * @param opts.itemId Tab to step forward.
 * @param opts.agentId Agent whose canvas the tab must be on. @default any
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Tab to step forward. */
    itemId: number;
    /** Agent whose canvas the tab must be on. @default any */
    agentId?: string;
}): Promise<{ item: types.canvas.Item; redone: { n: number; note: string | null } | null }> {
    const tab = await ctx.fns.canvas.tab({ itemId: opts.itemId, agentId: opts.agentId });
    const redone = (await ctx.fns.canvas.locked({
        agentId: tab.agentId,
        fn: async () => {
            const db = ctx.fns.procs.db;
            const next = ((await db.select({ sql: "SELECT n, note FROM canvas_edits WHERE item_id = ? AND undone_at IS NOT NULL AND dropped_at IS NULL ORDER BY n LIMIT 1", params: [tab.id] })) as any[])[0];
            if (!next) return null;
            await db.run({ sql: "UPDATE canvas_edits SET undone_at = NULL WHERE item_id = ? AND n = ?", params: [tab.id, next.n] });
            await ctx.fns.canvas.settle({ itemId: tab.id });
            return { n: Number(next.n), note: next.note ?? null };
        },
    })) as { n: number; note: string | null } | null;
    return { item: await ctx.fns.canvas.tab({ itemId: tab.id }), redone };
}
