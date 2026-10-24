/**
 * Lists the comments pinned to a canvas tab with their answers, oldest first: the open ones, or all with `all`.
 *
 * Use to see what the person asked about a tab (where it points, the words it quotes) before changing it, and
 * which comments still wait to be sent (sentAt null).
 * @param opts.itemId Tab whose comments to list.
 * @param opts.all Resolved ones too. @default false
 * @param opts.agentId Agent whose canvas the tab must be on. @default any
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Tab whose comments to list. */
    itemId: number;
    /** Resolved ones too. @default false */
    all?: boolean;
    /** Agent whose canvas the tab must be on. @default any */
    agentId?: string;
}): Promise<types.canvas.Comment[]> {
    const tab = await ctx.fns.canvas.tab({ itemId: opts.itemId, agentId: opts.agentId });
    const rows = (await ctx.fns.procs.db.select({ sql: "SELECT id, parent_id, author, text, quote, target, status, sent_at, created_at, resolved_at FROM canvas_comments WHERE item_id = ? ORDER BY id", params: [tab.id] })) as any[];
    const num = (v: unknown) => (v == null ? null : Number(v));
    const out: types.canvas.Comment[] = [];
    const byId = new Map<number, types.canvas.Comment>();
    for (const r of rows) {
        if (r.parent_id != null) {
            byId.get(Number(r.parent_id))?.replies.push({ id: Number(r.id), author: String(r.author), text: String(r.text), createdAt: Number(r.created_at) });
            continue;
        }
        const c: types.canvas.Comment = {
            id: Number(r.id), itemId: tab.id, author: String(r.author), text: String(r.text),
            target: r.target == null ? null : typeof r.target === "string" ? JSON.parse(r.target) : r.target,
            quote: r.quote ?? null, status: r.status === "resolved" ? "resolved" : "open",
            sentAt: num(r.sent_at), createdAt: Number(r.created_at), resolvedAt: num(r.resolved_at), replies: [],
        };
        byId.set(c.id, c);
        out.push(c);
    }
    return opts.all ? out : out.filter(c => c.status === "open");
}
