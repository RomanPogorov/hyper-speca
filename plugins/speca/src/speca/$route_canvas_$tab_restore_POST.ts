// POST /speca/canvas/:tab/restore — bring a saved version (v) back into the draft, as an edit that can be undone.
import { route } from "../../web/route.ts";
import { me, ownTab } from "../../web/canvasApi.ts";

export default route(async (c) => {
  const { tab } = await ownTab(c);
  const v = Number((await c.form()).v);
  if (!v) throw new Error("v is required");
  await c.h.fns.canvas.restore({ itemId: tab.id, v, author: me(c) });
  return null;
});
