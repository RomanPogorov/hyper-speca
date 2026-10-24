/**
 * Takes a canvas tab's draft back to how it was right after edit `n` — an undo of several steps at once; `n: 0`
 * drops the whole draft and goes back to the last version.
 *
 * The later edits leave the line (kept in the journal, not redoable).
 * @param opts.itemId Tab to step back.
 * @param opts.n The edit to go back to (from canvas.draft); 0 — the last version.
 * @param opts.agentId Agent whose canvas the tab must be on. @default any
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Tab to step back. */
    itemId: number;
    /** The edit to go back to (from canvas.draft); 0 — the last version. */
    n: number;
    /** Agent whose canvas the tab must be on. @default any */
    agentId?: string;
}): Promise<types.canvas.Item> {
    const tab = await ctx.fns.canvas.tab({ itemId: opts.itemId, agentId: opts.agentId });
    const n = Math.max(0, Math.floor(Number(opts.n) || 0));
    await ctx.fns.canvas.locked({
        agentId: tab.agentId,
        fn: async () => {
            const db = ctx.fns.procs.db;
            if (n > 0) {
                const at = ((await db.select({ sql: "SELECT n FROM canvas_edits WHERE item_id = ? AND n = ? AND undone_at IS NULL AND dropped_at IS NULL", params: [tab.id, n] })) as any[])[0];
                if (!at) throw new Error(`canvas.revertTo: tab ${tab.id} has no edit ${n} in its draft`);
            }
            const now = Date.now();
            await db.run({ sql: "UPDATE canvas_edits SET undone_at = COALESCE(undone_at, ?), dropped_at = COALESCE(dropped_at, ?) WHERE item_id = ? AND n > ?", params: [now, now, tab.id, n] });
            await ctx.fns.canvas.settle({ itemId: tab.id });
            return null;
        },
    });
    return ctx.fns.canvas.tab({ itemId: tab.id });
}
