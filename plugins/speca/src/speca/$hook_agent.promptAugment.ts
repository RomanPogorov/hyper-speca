// What the person did by hand in the chat's project folder since the agent's last turn (a file edited in the Files
// tab, changes reverted): told once, before the next turn, then forgotten.
/** Answers agent.promptAugment with the person's hand changes to the project folder, once.
 * @param opts.agentId Agent whose turn is being prepared.
 * @param opts.text Latest user message, verbatim.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Agent whose turn is being prepared. */
    agentId: string;
    /** Latest user message, verbatim. */
    text: string;
}): Promise<string> {
    const rows = (await ctx.fns.procs.db.select({ sql: "DELETE FROM speca_note WHERE agent_id = ? RETURNING text, created_at", params: [opts.agentId] }).catch(() => [])) as Array<{ text: string; created_at: string }>;
    if (!rows.length) return "";
    rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    return `<project_hand_edits>\n${rows.map((r) => `- ${r.text}`).join("\n")}\n</project_hand_edits>`;
}
