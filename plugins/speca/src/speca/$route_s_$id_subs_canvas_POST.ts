// POST /speca/s/:id/subs/canvas — the chat's subagents board, opened (or brought up) as a tab.
import { route } from "../../web/route.ts";
import { chatOf } from "../../web/pages.ts";
import { openKindTab } from "../../web/code/routes.ts";

export default route(async (c) => {
  const s = await chatOf(c);
  return openKindTab(c, s.id, "speca.subagents", c.t("subb.title"), null);
});
