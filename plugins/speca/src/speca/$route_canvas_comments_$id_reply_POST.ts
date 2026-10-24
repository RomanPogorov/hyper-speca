// POST /speca/canvas/comments/:id/reply — the person answers in a comment's thread.
import { route } from "../../web/route.ts";
import { commentOf, me } from "../../web/canvasApi.ts";

export default route(async (c) => {
  const { cm, tab } = await commentOf(c);
  const text = String((await c.form()).text ?? "").trim();
  if (text) await c.h.fns.canvas.addComment({ itemId: tab.id, parentId: cm.id, text, author: me(c) });
  return null;
});
