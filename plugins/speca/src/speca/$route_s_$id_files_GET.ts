// GET /speca/s/:id/files — every file of the chat's folder, and which of them this chat changed.
import { route } from "../../web/route.ts";
import { listFiles } from "../../web/code/files.ts";
import { chatChanges } from "../../web/code/changes.ts";
import { codeOf } from "../../web/code/routes.ts";

export default route(async (c) => {
  const { s, dir, h, canEdit } = await codeOf(c);
  const [list, ch] = await Promise.all([listFiles(h, dir), chatChanges(c.h, s.id)]);
  return Response.json({ ...list, canEdit, changed: Object.fromEntries(ch.all.map((f) => [f.path, f.status])) });
});
