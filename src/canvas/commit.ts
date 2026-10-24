/**
 * Saves a canvas tab's draft as a new version, with a name — only on purpose, when the person asks to save or fix
 * a version, or before trying another direction (named after the idea, so the two can be compared and the earlier
 * one brought back).
 *
 * The version keeps the whole content and the list of the draft's changes (their notes, authors, times); the
 * draft's journal starts over. A draft with no edits saves nothing and keeps the current version.
 * @param opts.itemId Tab to save.
 * @param opts.name The version's name; without one it is listed by its changes.
 * @param opts.author Who saved it. @default "agent" from an agent, otherwise "user"
 * @param opts.agentId Agent whose canvas the tab must be on. @default any
 */
export default async function (ctx: Context, session: Session | null, opts: {
    /** Tab to save. */
    itemId: number;
    /** The version's name; without one it is listed by its changes. */
    name?: string;
    /** Who saved it. @default "agent" from an agent, otherwise "user" */
    author?: string;
    /** Agent whose canvas the tab must be on. @default any */
    agentId?: string;
}): Promise<{ item: types.canvas.Item; committed: boolean; v: number }> {
    const tab = await ctx.fns.canvas.tab({ itemId: opts.itemId, agentId: opts.agentId });
    const author = String(opts.author ?? (session?.kind === "agent" ? "agent" : "user")).slice(0, 80);
    const v = (await ctx.fns.canvas.locked({
        agentId: tab.agentId,
        fn: async () => {
            const db = ctx.fns.procs.db;
            const cur = ((await db.select({ sql: "SELECT version, draft_edits, title, payload, state FROM canvas_items WHERE id = ? FOR UPDATE", params: [tab.id] })) as any[])[0];
            if (!cur || !Number(cur.draft_edits)) return null;
            const edits = (await db.select({ sql: "SELECT note, author, created_at FROM canvas_edits WHERE item_id = ? AND undone_at IS NULL AND dropped_at IS NULL ORDER BY n", params: [tab.id] })) as any[];
            const changes = edits.map(e => ({ note: e.note ?? null, author: String(e.author), at: Number(e.created_at) }));
            const top = ((await db.select({ sql: "SELECT COALESCE(MAX(v), 0) AS v FROM canvas_versions WHERE item_id = ?", params: [tab.id] })) as any[])[0];
            const next = Math.max(Number(cur.version) || 1, Number(top?.v) || 0) + 1;
            const body = JSON.stringify({ title: cur.title, args: parse(cur.payload), state: parse(cur.state) });
            await db.run({ sql: "INSERT INTO canvas_versions (item_id, v, author, note, body, changes, created_at) VALUES (?, ?, ?, ?, ?::jsonb, ?::jsonb, ?)", params: [tab.id, next, author, opts.name?.trim().slice(0, 200) || null, body, JSON.stringify(changes), Date.now()] });
            await db.run({ sql: "DELETE FROM canvas_edits WHERE item_id = ?", params: [tab.id] });
            await db.run({ sql: "UPDATE canvas_items SET version = ?, draft_edits = 0, updated_at = ? WHERE id = ?", params: [next, Date.now(), tab.id] });
            return next;
        },
    })) as number | null;
    return { item: await ctx.fns.canvas.tab({ itemId: tab.id }), committed: v != null, v: v ?? tab.version };
}

function parse(value: unknown): Record<string, any> {
    if (typeof value === "string") { try { return JSON.parse(value) ?? {}; } catch { return {}; } }
    return (value && typeof value === "object" ? value : {}) as Record<string, any>;
}
