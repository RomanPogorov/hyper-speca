/**
 * Puts the top of a canvas tab's draft line into the tab: the last edit not undone, or the version it started from.
 *
 * Called by canvas.undo, canvas.redo and canvas.revertTo inside the agent's canvas lock, after they moved the line;
 * it also recounts the draft's edits. Not for changing a tab — that is canvas.write.
 * @param opts.itemId Tab to settle.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Tab to settle. */
    itemId: number;
}): Promise<void> {
    const db = ctx.fns.procs.db;
    const itemId = Number(opts.itemId);
    const top = ((await db.select({ sql: "SELECT body FROM canvas_edits WHERE item_id = ? AND undone_at IS NULL AND dropped_at IS NULL ORDER BY n DESC LIMIT 1", params: [itemId] })) as any[])[0]
        ?? ((await db.select({ sql: "SELECT v.body FROM canvas_versions v JOIN canvas_items i ON i.id = v.item_id WHERE v.item_id = ? AND v.v = i.version", params: [itemId] })) as any[])[0];
    if (!top) return;
    const body = typeof top.body === "string" ? JSON.parse(top.body) : top.body ?? {};
    await db.run({
        sql: "UPDATE canvas_items SET title = COALESCE(?, title), payload = ?::jsonb, state = ?::jsonb, updated_at = ?, draft_edits = (SELECT COUNT(*) FROM canvas_edits WHERE item_id = ? AND undone_at IS NULL AND dropped_at IS NULL) WHERE id = ?",
        params: [body.title ?? null, JSON.stringify(body.args ?? {}), JSON.stringify(body.state ?? {}), Date.now(), itemId, itemId],
    });
}
