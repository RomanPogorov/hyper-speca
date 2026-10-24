// Tells the agent what its canvas shows. The block only changes when tabs, the active tab or a tab's state
// change, so agent.syncWorldState sends it once and again only then.
/** Answers agent.promptAugment with the open canvas tabs of the agent, the active one first, with its state.
 * @param opts.agentId Agent whose turn is being prepared.
 * @param opts.text Latest user message, verbatim.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Agent whose turn is being prepared. */
    agentId: string;
    /** Latest user message, verbatim. */
    text: string;
}): Promise<string> {
    const [view, items] = await Promise.all([ctx.fns.canvas.get({ agentId: opts.agentId }), ctx.fns.canvas.list({ agentId: opts.agentId })]);
    if (!items.length) return "";
    const kinds = ((ctx.state as any).canvas?.kinds ?? {}) as Record<string, types.canvas.Registered>;
    const line = async (item: types.canvas.Item) => {
        const kind = kinds[item.kind];
        let what = `${item.kind} ${JSON.stringify(item.args)}`;
        if (kind?.describe) what = await Promise.resolve(kind.describe(ctx, { item })).catch(() => what);
        // A view tab's history (back/forward) and page version are the tab's own bookkeeping, not what is on screen.
        const shown = Object.fromEntries(Object.entries(item.state).filter(([k]) => !(item.kind === "view" && ["back", "forward", "page"].includes(k))));
        const state = Object.keys(shown).length ? ` — state ${JSON.stringify(shown).slice(0, 1000)}` : "";
        const live = typeof kind?.live === "function" ? kind.live(item) : kind?.live;
        const mark = live === true ? "live, " : live === false ? `snapshot from ${new Date(item.updatedAt).toISOString().slice(0, 16).replace("T", " ")} UTC, ` : "";
        return `- [${item.id}] "${item.title}": ${mark}${what}${item.active ? " (active)" : ""}${await draftNote(item)}${state}`;
    };
    // Where the tab's draft stands: who changed it last and what was undone — so after the person edits, undoes or
    // goes back, the agent re-reads the tab instead of overwriting their change from memory.
    const draftNote = async (item: types.canvas.Item) => {
        if (["view", "url", "file"].includes(item.kind)) return "";
        const d = await ctx.fns.canvas.draft({ itemId: item.id }).catch(() => null);
        if (!d || (!d.edits.length && !d.redo.length)) return "";
        const last = d.edits[d.edits.length - 1];
        const by = (a: string) => (a === "agent" ? "you" : "the person");
        const parts = [`v${item.version}`];
        if (last) parts.push(`draft of ${d.edits.length} edit${d.edits.length > 1 ? "s" : ""}, last "${last.note ?? "edit"}" by ${by(last.author)}`);
        if (d.redo.length) parts.push(`${d.redo.length} edit${d.redo.length > 1 ? "s" : ""} undone`);
        const reread = (last && last.author !== "agent") || d.redo.length ? " — re-read it before changing it" : "";
        return ` [${parts.join("; ")}${reread}]`;
    };
    const ordered = [...items.filter(i => i.active), ...items.filter(i => !i.active)];
    return `## Canvas\n\nThe canvas beside the chat is ${view.open ? "open" : "closed"}; tabs:\n` + (await Promise.all(ordered.map(line))).join("\n");
}
