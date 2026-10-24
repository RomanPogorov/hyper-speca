// GET /speca/projects/:id/branch?s=<chat> — the branch chip by the send button, with the folder's git state (the
// chat's own folder: a chat is its own project here). Refreshed with the chat's events.
import { route } from "../../web/route.ts";
import { getSession } from "../../web/hyper.ts";
import { codeCtx } from "../../web/pages.ts";
import { codeDir } from "../../web/code/files.ts";
import { gitState } from "../../web/code/git.ts";
import { branchChip } from "../../web/views/chat.ts";

export default route(async (c) => {
  const sid = c.url.searchParams.get("s") || c.params.id!;
  if (!(await getSession(c.h, c.user.id, sid))) return "";
  const [code, dir] = await Promise.all([codeCtx(c, sid), codeDir(c.h, sid)]);
  if (!code || !dir) return "";
  return branchChip(c.t, code, sid, await gitState(dir.h, dir.dir), true);
});
