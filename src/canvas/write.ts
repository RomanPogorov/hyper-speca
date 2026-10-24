/**
 * Changes what a canvas tab holds — its args (the content: html, markdown, rows…), its state or its title — as an
 * edit of the tab's draft.
 *
 * Every write is kept in the tab's journal, so it can be undone (canvas.undo), redone (canvas.redo) and saved as
 * a version on purpose (canvas.commit); nothing becomes a version by itself. The agent's writes within one answer
 * are one step to undo (a kind with `undo: "each"` keeps each write its own step). New args go through the kind's
 * prepare, like canvas.show. When the agent writes a tab it moved to, that tab comes to the front — once per
 * answer, so a person who looked away is not pulled back. Use canvas.edit to change part of a text.
 * @param opts.itemId Tab to change.
 * @param opts.args New args (the whole content); omitted keeps them.
 * @param opts.state New state (whole); omitted keeps it.
 * @param opts.title New title; omitted keeps it.
 * @param opts.note What changed, in a few words — the journal and the version's list of changes show it.
 * @param opts.author Who changed it: "agent" or "user:<id>". @default "agent" from an agent, otherwise "user"
 * @param opts.agentId Agent whose canvas the tab must be on. @default any
 * @param opts.turn The answer this edit belongs to. @default the agent's open turn
 */
export default async function (ctx: Context, session: Session | null, opts: {
    /** Tab to change. */
    itemId: number;
    /** New args (the whole content); omitted keeps them. */
    args?: Record<string, any>;
    /** New state (whole); omitted keeps it. */
    state?: Record<string, any>;
    /** New title; omitted keeps it. */
    title?: string;
    /** What changed, in a few words — the journal and the version's list of changes show it. */
    note?: string;
    /** Who changed it: "agent" or "user:<id>". @default "agent" from an agent, otherwise "user" */
    author?: string;
    /** Agent whose canvas the tab must be on. @default any */
    agentId?: string;
    /** The answer this edit belongs to. @default the agent's open turn */
    turn?: string;
}): Promise<types.canvas.Item> {
    const tab = await ctx.fns.canvas.tab({ itemId: opts.itemId, agentId: opts.agentId });
    const fromAgent = session?.kind === "agent";
    const author = String(opts.author ?? (fromAgent ? "agent" : "user")).slice(0, 80);
    const live = (ctx.state as any).agent?.[tab.agentId] as types.agent.Agent | undefined;
    const turn = opts.turn ?? (author === "agent" ? (session?.agent ?? live)?.scratchpad?.turn : null) ?? null;
    const kind = ((ctx.state as any).canvas?.kinds ?? {})[tab.kind] as types.canvas.Registered | undefined;
    let args = tab.args;
    if (opts.args) args = kind?.prepare ? ((await kind.prepare(ctx, { agentId: tab.agentId, args: opts.args })).args ?? {}) : opts.args;
    const state = opts.state ?? tab.state;
    const title = opts.title?.trim() ? String(opts.title).trim().slice(0, 200) : tab.title;
    const body = { title, args, state };
    const text = JSON.stringify(body);
    if (text.length > 2_000_000) throw new Error("canvas.write: a tab holds at most 2 MB — keep large content in files");
    if (text === JSON.stringify({ title: tab.title, args: tab.args, state: tab.state })) return tab;
    const note = opts.note?.trim() ? opts.note.trim().slice(0, 300) : null;

    await ctx.fns.canvas.locked({
        agentId: tab.agentId,
        fn: async () => {
            const db = ctx.fns.procs.db;
            const now = Date.now();
            // The version the draft started from is kept first (a tab from before versions gets its v1 now).
            await db.run({ sql: "INSERT INTO canvas_versions (item_id, v, author, note, body, created_at) SELECT ?, ?, 'agent', NULL, ?::jsonb, ? WHERE NOT EXISTS (SELECT 1 FROM canvas_versions WHERE item_id = ?)", params: [tab.id, tab.version, JSON.stringify({ title: tab.title, args: tab.args, state: tab.state }), tab.createdAt, tab.id] });
            // A new edit after an undo: what was undone can no longer be redone (kept, dropped from the line).
            await db.run({ sql: "UPDATE canvas_edits SET dropped_at = ? WHERE item_id = ? AND undone_at IS NOT NULL AND dropped_at IS NULL", params: [now, tab.id] });
            const last = ((await db.select({ sql: "SELECT n, author, note, turn, undone_at, dropped_at FROM canvas_edits WHERE item_id = ? ORDER BY n DESC LIMIT 1", params: [tab.id] })) as any[])[0];
            const joins = !!last && last.undone_at == null && last.dropped_at == null && kind?.undo !== "each" && !!turn && last.turn === turn && last.author === author;
            if (joins) {
                const joined = [last.note, note].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(" · ").slice(0, 300) || null;
                await db.run({ sql: "UPDATE canvas_edits SET body = ?::jsonb, note = ?, created_at = ? WHERE item_id = ? AND n = ?", params: [text, joined, now, tab.id, last.n] });
            } else {
                await db.run({ sql: "INSERT INTO canvas_edits (item_id, n, author, note, body, turn, created_at) VALUES (?, ?, ?, ?, ?::jsonb, ?, ?)", params: [tab.id, Number(last?.n ?? 0) + 1, author, note, text, turn, now] });
            }
            await db.run({ sql: "UPDATE canvas_items SET title = ?, payload = ?::jsonb, state = ?::jsonb, updated_at = ?, draft_edits = (SELECT COUNT(*) FROM canvas_edits WHERE item_id = ? AND undone_at IS NULL AND dropped_at IS NULL) WHERE id = ?", params: [title, JSON.stringify(args), JSON.stringify(state), now, tab.id, tab.id] });
            // The agent moved on to another tab: show it — once per answer and tab, never pulling a person back.
            if (author === "agent" && turn && tab.closedAt == null) {
                const followed: Map<string, string> = ((ctx.state as any).canvas ??= {}).followed ??= new Map();
                const mark = `${turn}#${tab.id}`;
                if (followed.get(tab.agentId) !== mark) {
                    followed.set(tab.agentId, mark);
                    if (!tab.active) await db.run({ sql: "UPDATE canvas_state SET open = true, active_item_id = ?, updated_at = ? WHERE agent_id = ?", params: [tab.id, now, tab.agentId] });
                }
            }
            return null;
        },
    });
    return ctx.fns.canvas.tab({ itemId: tab.id });
}
