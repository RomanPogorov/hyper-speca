// POST /speca/s/:id/files/op {op: save|create|rename|delete, path, …} — the person's own change to the chat's folder.
import { route } from "../../web/route.ts";
import { personEdit } from "../../web/code/files.ts";
import { codeOf, filesErr } from "../../web/code/routes.ts";

export default route(async (c) => {
  const { s, dir, h, canEdit } = await codeOf(c);
  if (!canEdit) return Response.json({ error: "owner", message: c.t("pfiles.ownerOnly") }, { status: 403 });
  const f = await c.form();
  // the text comes as a file part (a string field's line breaks would be turned into CRLF on the way)
  const part = (await c.formAll()).get("content");
  const content = typeof part === "string" ? part : part ? await part.text() : "";
  const op = f.op === "save" ? { op: "save" as const, path: f.path!, content, version: f.version ?? "" }
    : f.op === "create" ? { op: "create" as const, path: f.path!, folder: f.folder === "1" }
    : f.op === "rename" ? { op: "rename" as const, path: f.path!, to: f.to ?? "" }
    : f.op === "delete" ? { op: "delete" as const, path: f.path! } : null;
  if (!op || !f.path) return Response.json({ error: "invalid" }, { status: 400 });
  try { return Response.json(await personEdit(c.h, h, { agentId: s.id, userId: c.user.id, dir }, op)); }
  catch (e) { const r = filesErr(e); if (r) return r; throw e; }
});
