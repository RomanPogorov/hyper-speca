// GET /speca/sub/:id/card — a subagent's live card in its parent's chat (it asks for itself again while the subagent works).
import { route } from "../../web/route.ts";
import { subView } from "../../web/subs.ts";
import { subagentCard } from "../../web/views/chat.ts";
import { pending } from "../../web/approvals.ts";

export default route(async (c) => {
  const r = await subView(c.h, String(c.params.id ?? ""));
  if (!r) return "";
  // the subagent's confirmations are decided right on its card
  const asks = (await pending(c.h, { agentId: r.v.id })).filter((a) => a.kind === "local" || a.kind === "effect");
  return subagentCard(c.t, { ...r.v, approvals: asks.length }, r.parentId, asks, String((c.user as any)?.timezone ?? "UTC"));
});
