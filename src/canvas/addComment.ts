/**
 * Pins a comment to a canvas tab — to the whole tab or to a place in it (an element, a piece of text, a point) —
 * or answers one (parentId).
 *
 * A person's comments wait as a list until they are sent to the agent together (canvas.sendComments); the agent
 * answers (canvas.addComment with parentId) or resolves them (canvas.resolveComment). The target is what the tab's
 * kind understands: for an html page { path, text, fx, fy }, for a design canvas { file, tid }.
 * @param opts.itemId Tab to comment on.
 * @param opts.text The comment.
 * @param opts.target Where in the tab it is pinned. @default the whole tab
 * @param opts.quote The text or element it points at, as the person saw it.
 * @param opts.parentId The comment this one answers.
 * @param opts.author Who wrote it. @default "agent" from an agent, otherwise "user"
 * @param opts.agentId Agent whose canvas the tab must be on. @default any
 */
export default async function (ctx: Context, session: Session | null, opts: {
    /** Tab to comment on. */
    itemId: number;
    /** The comment. */
    text: string;
    /** Where in the tab it is pinned. @default the whole tab */
    target?: Record<string, any>;
    /** The text or element it points at, as the person saw it. */
    quote?: string;
    /** The comment this one answers. */
    parentId?: number;
    /** Who wrote it. @default "agent" from an agent, otherwise "user" */
    author?: string;
    /** Agent whose canvas the tab must be on. @default any */
    agentId?: string;
}): Promise<types.canvas.Comment> {
    const tab = await ctx.fns.canvas.tab({ itemId: opts.itemId, agentId: opts.agentId });
    const text = String(opts.text ?? "").trim().slice(0, 4000);
    if (!text) throw new Error("canvas.addComment: text is required");
    const author = String(opts.author ?? (session?.kind === "agent" ? "agent" : "user")).slice(0, 80);
    let parent: number | null = null;
    if (opts.parentId != null) {
        const p = ((await ctx.fns.procs.db.select({ sql: "SELECT id, parent_id FROM canvas_comments WHERE id = ? AND item_id = ?", params: [Number(opts.parentId), tab.id] })) as any[])[0];
        if (!p) throw new Error(`canvas.addComment: no comment ${opts.parentId} on tab ${tab.id}`);
        parent = Number(p.parent_id ?? p.id);
    }
    const id = await ctx.fns.canvas.locked({
        agentId: tab.agentId,
        fn: async () => {
            const now = Date.now();
            const rows = (await ctx.fns.procs.db.select({
                sql: "INSERT INTO canvas_comments (item_id, parent_id, author, text, quote, target, created_at, sent_at) VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, ?) RETURNING id",
                // The agent's own words and answers wait in nobody's list: they count as sent.
                params: [tab.id, parent, author, text, opts.quote ? String(opts.quote).slice(0, 500) : null, opts.target ? JSON.stringify(opts.target) : null, now, author === "agent" || parent != null ? now : null],
            })) as any[];
            await ctx.fns.procs.db.run({ sql: "UPDATE canvas_items SET updated_at = ? WHERE id = ?", params: [now, tab.id] });
            return Number(rows[0].id);
        },
    });
    return (await ctx.fns.canvas.comments({ itemId: tab.id, all: true })).find(c => c.id === (parent ?? id))!;
}
