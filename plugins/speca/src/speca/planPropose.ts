import { ask, chatFor, stopSignal } from "../../web/approvals.ts";
import { agentOf } from "../../web/design/tools.ts";

/**
 * In plan mode: put a complete plan to the person for approval (a card in the chat) and wait for their decision.
 * Approval switches the chat to work mode — then do it. If they ask for changes, the answer says what: revise the
 * plan and propose it again.
 * @param opts.markdown The whole plan as markdown, starting with a "# " heading.
 */
export default async function (ctx: Context, session: Session | null, opts: {
  /** The whole plan as markdown, starting with a "# " heading. */
  markdown: string;
}): Promise<string> {
  const markdown = String(opts.markdown ?? "").trim();
  if (!/^#\s/.test(markdown)) throw new Error("speca.planPropose: markdown must start with a '# ' heading");
  const agentId = await agentOf(ctx, session);
  if (!agentId) throw new Error("speca.planPropose: only an agent can propose a plan");
  const chat = await chatFor(ctx as any, agentId);
  if (chat.sub) return "No one reviews a subagent's plan; include the plan in your report.";
  const r = await ask(ctx as any, chat, {
    agentId, kind: "plan", summary: markdown.split("\n")[0]!.replace(/^#\s*/, ""), preview: { markdown },
    event: { type: "plan_review", markdown }, signal: stopSignal(ctx, agentId),
  });
  if (r.status === "approved") return "The person approved the plan; the chat is in work mode now. Go on and do it.";
  if (r.status === "rejected" && r.note && r.note !== "wrote_instead") return `The person asked to change the plan: ${r.note}\nRevise it and propose again.`;
  if (r.status === "rejected" && r.note === "wrote_instead") return "Instead of deciding, the person wrote to you (their message follows). Answer it first.";
  return `The plan was not approved (${r.status}).`;
}
