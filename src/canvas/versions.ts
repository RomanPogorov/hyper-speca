/**
 * Lists a canvas tab's saved versions, newest first: number, name, who saved it, when, and the changes it holds.
 *
 * Use to show the version history, to compare two versions (canvas.version reads each) or to pick one to bring
 * back (canvas.restore). The draft — edits since the last version — is canvas.draft.
 * @param opts.itemId Tab whose versions to list.
 * @param opts.agentId Agent whose canvas the tab must be on. @default any
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Tab whose versions to list. */
    itemId: number;
    /** Agent whose canvas the tab must be on. @default any */
    agentId?: string;
}): Promise<Array<{ v: number; name: string | null; author: string; createdAt: number; changes: Array<{ note: string | null; author: string; at: number }> }>> {
    const tab = await ctx.fns.canvas.tab({ itemId: opts.itemId, agentId: opts.agentId });
    const rows = (await ctx.fns.procs.db.select({ sql: "SELECT v, note, author, created_at, changes FROM canvas_versions WHERE item_id = ? ORDER BY v DESC", params: [tab.id] })) as any[];
    // A tab never written since it opened has its first version in itself.
    if (!rows.length) return [{ v: tab.version, name: null, author: "agent", createdAt: tab.createdAt, changes: [] }];
    return rows.map(r => ({
        v: Number(r.v), name: r.note ?? null, author: String(r.author), createdAt: Number(r.created_at),
        changes: Array.isArray(r.changes) ? r.changes : (typeof r.changes === "string" ? JSON.parse(r.changes) : []),
    }));
}
