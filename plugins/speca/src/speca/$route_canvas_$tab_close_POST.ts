// POST /speca/canvas/:tab/close — close a tab (it stays in "Recently closed" and can come back).
import { route } from "../../web/route.ts";
import { chatOfTab } from "../../web/canvas.ts";

export default route(async (c) => {
  const tab = Number(c.params.tab);
  const s = await chatOfTab(c, tab);
  await c.h.fns.canvas.close({ agentId: s.id, itemId: tab });
  return null;
});
