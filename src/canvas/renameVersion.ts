/**
 * Names (or renames) a saved version of a canvas tab; an empty name removes it, and the version is listed by its
 * changes again.
 * @param opts.itemId Tab of the version.
 * @param opts.v Version number.
 * @param opts.name The new name.
 * @param opts.agentId Agent whose canvas the tab must be on. @default any
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Tab of the version. */
    itemId: number;
    /** Version number. */
    v: number;
    /** The new name. */
    name: string;
    /** Agent whose canvas the tab must be on. @default any */
    agentId?: string;
}): Promise<{ renamed: boolean }> {
    const tab = await ctx.fns.canvas.tab({ itemId: opts.itemId, agentId: opts.agentId });
    const renamed = (await ctx.fns.canvas.locked({
        agentId: tab.agentId,
        fn: async () => {
            const rows = (await ctx.fns.procs.db.select({ sql: "UPDATE canvas_versions SET note = ? WHERE item_id = ? AND v = ? RETURNING v", params: [String(opts.name ?? "").trim().slice(0, 200) || null, tab.id, Number(opts.v)] })) as any[];
            if (rows.length) await ctx.fns.procs.db.run({ sql: "UPDATE canvas_items SET updated_at = ? WHERE id = ?", params: [Date.now(), tab.id] });
            return rows.length > 0;
        },
    })) as boolean;
    return { renamed };
}
