// POST /speca/canvas/comments/:id/remove — delete one of the person's own comments with its thread.
import { route } from "../../web/route.ts";
import { commentOf, me } from "../../web/canvasApi.ts";

export default route(async (c) => {
  const { cm, tab } = await commentOf(c);
  if (cm.author !== me(c) && cm.author !== "user") throw new Error(c.t("common.forbidden"));
  await c.h.fns.canvas.removeComments({ itemId: tab.id, author: cm.author, ids: [cm.id] });
  return null;
});
