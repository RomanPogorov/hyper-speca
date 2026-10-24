// GET /speca/s/:id/subs/board — the subagents board of a chat (asks for itself again while any works).
import { route } from "../../web/route.ts";
import { chatOf } from "../../web/pages.ts";
import { subBoard } from "../../web/subs.ts";

export default route(async (c) => {
  const s = await chatOf(c);
  return subBoard(c.h, c.t, s.id);
});
