// POST /speca/canvas/comments/:id/resolve — resolve a comment, or open it again (undo=1).
import { route } from "../../web/route.ts";
import { commentOf } from "../../web/canvasApi.ts";

export default route(async (c) => {
  const { cm } = await commentOf(c);
  await c.h.fns.canvas.resolveComment({ id: cm.id, resolved: (await c.form()).undo !== "1" });
  return null;
});
