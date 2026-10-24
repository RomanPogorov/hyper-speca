// GET /speca/sub/:id/card — a subagent's live card in its parent's chat (it asks for itself again while the subagent works).
import { route } from "../../web/route.ts";
import { subView } from "../../web/subs.ts";
import { subagentCard } from "../../web/views/chat.ts";

export default route(async (c) => {
  const r = await subView(c.h, String(c.params.id ?? ""));
  if (!r) return "";
  return subagentCard(c.t, r.v, r.parentId, [], String((c.user as any)?.timezone ?? "UTC"));
});
