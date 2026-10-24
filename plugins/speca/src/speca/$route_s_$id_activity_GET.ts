// GET /speca/s/:id/activity — the "working…" line of an open turn (what the agent does right now).
import { route } from "../../web/route.ts";
import { getSession } from "../../web/hyper.ts";
import { activityLine } from "../../web/views/chat.ts";

export default route(async (c) => {
  const s = await getSession(c.h, c.user.id, c.params.id!);
  return s ? activityLine(c.t, s, true, false) : "";
});
