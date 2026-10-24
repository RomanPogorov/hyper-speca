// POST /speca/s/:id/timeline/open — the chat's Timeline tab, opened (or brought up).
import { route } from "../../web/route.ts";
import { chatOf } from "../../web/pages.ts";
import { openKindTab } from "../../web/code/routes.ts";

export default route(async (c) => {
  const s = await chatOf(c);
  return openKindTab(c, s.id, "speca.timeline", c.t("tl.title"), null);
});
