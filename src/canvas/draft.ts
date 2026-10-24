/**
 * Lists the edits of a canvas tab's draft since its last version, oldest first, and the undone ones that can
 * still be redone.
 *
 * Use to show the draft's journal ("3 changes since v2"), to step back to one edit (canvas.revertTo) or to know
 * whether there is anything to save.
 * @param opts.itemId Tab whose draft to read.
 * @param opts.agentId Agent whose canvas the tab must be on. @default any
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Tab whose draft to read. */
    itemId: number;
    /** Agent whose canvas the tab must be on. @default any */
    agentId?: string;
}): Promise<{ version: number; edits: Array<{ n: number; author: string; note: string | null; at: number }>; redo: Array<{ n: number; author: string; note: string | null; at: number }> }> {
    const tab = await ctx.fns.canvas.tab({ itemId: opts.itemId, agentId: opts.agentId });
    const rows = (await ctx.fns.procs.db.select({ sql: "SELECT n, author, note, created_at, undone_at FROM canvas_edits WHERE item_id = ? AND dropped_at IS NULL ORDER BY n", params: [tab.id] })) as any[];
    const one = (r: any) => ({ n: Number(r.n), author: String(r.author), note: r.note ?? null, at: Number(r.created_at) });
    return { version: tab.version, edits: rows.filter(r => r.undone_at == null).map(one), redo: rows.filter(r => r.undone_at != null).map(one) };
}
