/**
 * Reads one canvas tab by its id, open or closed, with its saved version and the size of its draft.
 *
 * Use when you have a tab id (from a link, a comment, a version) and need the tab itself; canvas.list reads a
 * whole canvas. With `agentId` the tab must be on that agent's canvas.
 * @param opts.itemId Tab id.
 * @param opts.agentId Agent whose canvas the tab must be on. @default any
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Tab id. */
    itemId: number;
    /** Agent whose canvas the tab must be on. @default any */
    agentId?: string;
}): Promise<types.canvas.Item> {
    const r = ((await ctx.fns.procs.db.select({ sql: "SELECT id, agent_id, kind, title, payload, state, created_at, updated_at, closed_at, version, draft_edits FROM canvas_items WHERE id = ?", params: [Number(opts.itemId)] })) as any[])[0];
    if (!r || (opts.agentId && String(r.agent_id) !== String(opts.agentId))) throw new Error(`canvas.tab: no tab ${opts.itemId}${opts.agentId ? ` on ${opts.agentId}'s canvas` : ""}`);
    const view = await ctx.fns.canvas.get({ agentId: String(r.agent_id) });
    return {
        id: Number(r.id), agentId: String(r.agent_id), kind: String(r.kind), title: String(r.title ?? ""),
        args: json(r.payload), state: json(r.state), active: r.closed_at == null && Number(r.id) === view.activeItemId,
        createdAt: Number(r.created_at), updatedAt: Number(r.updated_at), closedAt: r.closed_at == null ? null : Number(r.closed_at),
        version: Number(r.version) || 1, draftEdits: Number(r.draft_edits) || 0,
    };
}

function json(value: unknown): Record<string, any> {
    if (typeof value === "string") { try { return JSON.parse(value) ?? {}; } catch { return {}; } }
    return (value && typeof value === "object" ? value : {}) as Record<string, any>;
}
