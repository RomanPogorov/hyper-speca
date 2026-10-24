// GET /speca/s/:id/changes — the turns of this chat that changed files in its folder, and the whole chat's files.
import { route } from "../../web/route.ts";
import { chatOf } from "../../web/pages.ts";
import { chatChanges } from "../../web/code/changes.ts";
import { codeDir } from "../../web/code/files.ts";

export default route(async (c) => {
  const s = await chatOf(c);
  return Response.json({ ...(await chatChanges(c.h, s.id)), canRevert: !!(await codeDir(c.h, s.id)) });
});
