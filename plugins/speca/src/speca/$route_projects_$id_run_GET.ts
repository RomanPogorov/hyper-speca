// GET /speca/projects/:id/run?s=<chat> — the run control of the composer bar (no project scripts in Hyper yet: empty).
import { route } from "../../web/route.ts";
import { codeCtx } from "../../web/pages.ts";
import { runCtl } from "../../web/views/chat.ts";

export default route(async (c) => {
  const code = await codeCtx(c, c.url.searchParams.get("s") || c.params.id!);
  return code ? runCtl(c.t, code, c.url.searchParams.get("s") || c.params.id!) : "";
});
