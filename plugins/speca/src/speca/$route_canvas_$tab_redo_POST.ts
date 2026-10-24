// POST /speca/canvas/:tab/redo — bring back the step undone last.
import { route } from "../../web/route.ts";
import { ownTab } from "../../web/canvasApi.ts";

export default route(async (c) => {
  const { tab } = await ownTab(c);
  const r = await c.h.fns.canvas.redo({ itemId: tab.id });
  return r.redone ? null : Response.json({ reason: "nothing" }, { status: 409 });
});
