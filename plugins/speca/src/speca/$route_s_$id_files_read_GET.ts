// GET /speca/s/:id/files/read?path — one file for the viewer: its text, or what it is when it is not text.
import { route } from "../../web/route.ts";
import { readProjectFile } from "../../web/code/files.ts";
import { codeOf, filesErr } from "../../web/code/routes.ts";

export default route(async (c) => {
  const { dir, h } = await codeOf(c);
  try { return Response.json(await readProjectFile(h, dir, String(c.url.searchParams.get("path") ?? ""))); }
  catch (e) { const r = filesErr(e); if (r) return r; throw e; }
});
