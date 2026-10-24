// POST /speca/canvas/:tab/undo — take the draft one step back (one answer of the agent, or one change of the person).
import { route } from "../../web/route.ts";
import { ownTab } from "../../web/canvasApi.ts";

export default route(async (c) => {
  const { tab } = await ownTab(c);
  const r = await c.h.fns.canvas.undo({ itemId: tab.id });
  return r.undone ? null : Response.json({ reason: "nothing" }, { status: 409 });
});
