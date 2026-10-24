// POST /speca/canvas/:tab/comments/resolve — "clear all": every open comment of the tab resolved (they come back
// with "show resolved").
import { route } from "../../web/route.ts";
import { ownTab } from "../../web/canvasApi.ts";

export default route(async (c) => {
  const { tab } = await ownTab(c);
  const open = await c.h.fns.canvas.comments({ itemId: tab.id });
  for (const x of open) await c.h.fns.canvas.resolveComment({ id: x.id });
  return Response.json({ resolved: open.length });
});
