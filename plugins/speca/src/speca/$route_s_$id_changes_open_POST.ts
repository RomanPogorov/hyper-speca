// POST /speca/s/:id/changes/open {turn?, file?} — the chat's Changes tab, opened (or brought up) on a turn or the whole chat.
import { route } from "../../web/route.ts";
import { chatOf } from "../../web/pages.ts";
import { openKindTab } from "../../web/code/routes.ts";

export default route(async (c) => {
  const s = await chatOf(c);
  const f = await c.form();
  return openKindTab(c, s.id, "speca.changes", c.t("chg.tab"), { turnId: f.turn || null, ...(f.file ? { file: String(f.file) } : {}) });
});
