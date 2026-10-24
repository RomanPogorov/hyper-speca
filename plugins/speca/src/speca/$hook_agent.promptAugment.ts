import { linksText } from "../../web/proto.ts";
import { chatFor } from "../../web/approvals.ts";
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
    // design ↔ prototype links of this chat and whether either side changed since they matched (Speca's canvas_list)
    const links = await linksText(ctx as any, opts.agentId).catch(() => "");
    const linked = [links ? `<prototype_links>\n${links}\n</prototype_links>` : "", await modeNote(ctx, opts.agentId)].filter(Boolean).join("\n");
    const rows = (await ctx.fns.procs.db.select({ sql: "DELETE FROM speca_note WHERE agent_id = ? RETURNING text, created_at", params: [opts.agentId] }).catch(() => [])) as Array<{ text: string; created_at: string }>;
    if (!rows.length) return linked;
    rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    return `${linked ? `${linked}\n` : ""}<project_hand_edits>\n${rows.map((r) => `- ${r.text}`).join("\n")}\n</project_hand_edits>`;
}

/** The chat's mode and autonomy as the person set them (web/approvals.ts holds every call to them). */
async function modeNote(ctx: Context, agentId: string): Promise<string> {
    const c = await chatFor(ctx as any, agentId).catch(() => null);
    if (!c) return "";
    const lines = [
        c.mode === "plan"
            ? "Plan mode: only read and study now — every change is refused. When the plan is ready, put it to the person with ctx.fns.speca.planPropose({ markdown }) (markdown starting with \"# \"); their approval switches the chat to work mode."
            : "",
        c.autonomy === "read_only" ? "Autonomy: read only — changes are refused; describe what you would do." :
        c.autonomy === "ask" ? "Autonomy: ask — every change waits for the person's confirmation on a card in the chat; group changes into few calls." :
        c.autonomy === "drafts" ? "Autonomy: drafts — changes in this chat's folder and canvases go through; commands and actions outside wait for the person's confirmation." :
        "Autonomy: full access — only irreversible actions (deleting folders, force pushes, dropping tables) wait for the person's confirmation.",
        "To ask the person a question with options (only when you cannot go on sensibly without their choice): ctx.fns.speca.askUser({ questions: [{ question, options?, recommended?, multiple? }] }) — it waits for their answer.",
    ].filter(Boolean);
    const rules = c.rules ? `\n<my_rules>\nThe person's own rules for their agent (Settings → My agent); follow them:\n${c.rules}\n</my_rules>` : "";
    return `<chat_mode>\n${lines.join("\n")}\n</chat_mode>${rules}`;
}
