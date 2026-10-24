// POST /speca/canvas/:tab/revert — take the draft back to the moment right after edit n (0: drop the draft).
import { route } from "../../web/route.ts";
import { ownTab } from "../../web/canvasApi.ts";

export default route(async (c) => {
  const { tab } = await ownTab(c);
  await c.h.fns.canvas.revertTo({ itemId: tab.id, n: Number((await c.form()).n) || 0 });
  return null;
});
