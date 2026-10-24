// POST /speca/canvas/:tab/comments/remove — several of the person's own comments deleted at once (ids, or all=1).
import { route } from "../../web/route.ts";
import { me, ownTab } from "../../web/canvasApi.ts";

export default route(async (c) => {
  const { tab } = await ownTab(c);
  const f = await c.form();
  const ids = f.all === "1" ? undefined : String(f.ids ?? "").split(",").map((x) => Number(x.trim())).filter(Boolean).slice(0, 500);
  if (ids && !ids.length) return Response.json({ removed: 0 });
  return Response.json(await c.h.fns.canvas.removeComments({ itemId: tab.id, author: me(c), ids }));
});
