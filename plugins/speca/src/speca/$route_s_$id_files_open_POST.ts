// POST /speca/s/:id/files/open {path?} — the chat's Files tab, opened (or brought up), on a file if given.
import { route } from "../../web/route.ts";
import { codeOf, openKindTab } from "../../web/code/routes.ts";

export default route(async (c) => {
  const { s } = await codeOf(c);
  const f = await c.form();
  return openKindTab(c, s.id, "speca.files", c.t("pfiles.tab"), f.path ? { path: String(f.path) } : null);
});
