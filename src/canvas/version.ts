/**
 * Reads a canvas tab's content at one saved version, or the current draft — title, args and state.
 *
 * Use to compare two versions side by side or to see what a version held before bringing it back.
 * @param opts.itemId Tab to read.
 * @param opts.v Version number; omitted reads the current draft.
 * @param opts.agentId Agent whose canvas the tab must be on. @default any
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Tab to read. */
    itemId: number;
    /** Version number; omitted reads the current draft. */
    v?: number;
    /** Agent whose canvas the tab must be on. @default any */
    agentId?: string;
}): Promise<{ v: number | null; title: string; args: Record<string, any>; state: Record<string, any> }> {
    const tab = await ctx.fns.canvas.tab({ itemId: opts.itemId, agentId: opts.agentId });
    if (opts.v == null) return { v: null, title: tab.title, args: tab.args, state: tab.state };
    const row = ((await ctx.fns.procs.db.select({ sql: "SELECT body FROM canvas_versions WHERE item_id = ? AND v = ?", params: [tab.id, Number(opts.v)] })) as any[])[0];
    // The first version of a tab never written is what it holds now.
    if (!row && Number(opts.v) === tab.version && !tab.draftEdits) return { v: tab.version, title: tab.title, args: tab.args, state: tab.state };
    if (!row) throw new Error(`canvas.version: tab ${tab.id} has no version ${opts.v}`);
    const body = typeof row.body === "string" ? JSON.parse(row.body) : row.body ?? {};
    return { v: Number(opts.v), title: String(body.title ?? tab.title), args: body.args ?? {}, state: body.state ?? {} };
}
