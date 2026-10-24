/**
 * Changes part of a canvas tab's text — an html page, a document, any text field — by replacing exact snippets,
 * like editing code; saved as an edit of the draft (canvas.write).
 *
 * Each edit has `old` (an exact piece of the current text, found once unless `all`) and `new`. All apply together
 * or none: a snippet that is missing or found more than once fails the whole call and names it. Cheaper and safer
 * than writing the whole content again.
 * @param opts.itemId Tab to change.
 * @param opts.edits Replacements, applied in order.
 * @param opts.field The text field: a key of the tab's args (or "state.<key>"). @default html, markdown or text — the first the args have
 * @param opts.note What changed, in a few words.
 * @param opts.author Who changed it. @default "agent" from an agent, otherwise "user"
 * @param opts.agentId Agent whose canvas the tab must be on. @default any
 * @param opts.turn The answer this edit belongs to. @default the agent's open turn
 */
export default async function (ctx: Context, session: Session | null, opts: {
    /** Tab to change. */
    itemId: number;
    /** Replacements, applied in order. */
    edits: Array<{ old: string; new: string; all?: boolean }>;
    /** The text field: a key of the tab's args (or "state.<key>"). @default html, markdown or text — the first the args have */
    field?: string;
    /** What changed, in a few words. */
    note?: string;
    /** Who changed it. @default "agent" from an agent, otherwise "user" */
    author?: string;
    /** Agent whose canvas the tab must be on. @default any */
    agentId?: string;
    /** The answer this edit belongs to. @default the agent's open turn */
    turn?: string;
}): Promise<types.canvas.Item> {
    const tab = await ctx.fns.canvas.tab({ itemId: opts.itemId, agentId: opts.agentId });
    const inState = !!opts.field?.startsWith("state.");
    const key = opts.field ? opts.field.replace(/^(args|state)\./, "") : ["html", "markdown", "text"].find(k => typeof tab.args[k] === "string");
    const holder = inState ? tab.state : tab.args;
    if (!key || typeof holder[key] !== "string") throw new Error(`canvas.edit: tab ${tab.id} has no text field ${opts.field ?? "(html, markdown or text)"} — pass field`);
    if (!Array.isArray(opts.edits) || !opts.edits.length) throw new Error("canvas.edit: edits are required");
    let text: string = holder[key];
    opts.edits.forEach((e, i) => {
        const old = String(e?.old ?? "");
        if (!old) throw new Error(`canvas.edit: edit ${i + 1} has an empty old`);
        const count = text.split(old).length - 1;
        if (!count) throw new Error(`canvas.edit: edit ${i + 1} — not found: ${JSON.stringify(old.slice(0, 120))}`);
        if (count > 1 && !e.all) throw new Error(`canvas.edit: edit ${i + 1} — found ${count} times, make it unique or pass all: ${JSON.stringify(old.slice(0, 120))}`);
        text = e.all ? text.split(old).join(String(e.new ?? "")) : text.replace(old, () => String(e.new ?? ""));
    });
    const next = { ...holder, [key]: text };
    return ctx.fns.canvas.write({ itemId: tab.id, ...(inState ? { state: next } : { args: next }), note: opts.note, turn: opts.turn, author: opts.author ?? (session?.kind === "agent" ? "agent" : undefined) });
}
