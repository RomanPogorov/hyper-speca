// POST /speca/canvas/:tab/activate — show this tab on its chat's canvas.
import { route } from "../../web/route.ts";
import { chatOfTab } from "../../web/canvas.ts";

export default route(async (c) => {
  const tab = Number(c.params.tab);
  const s = await chatOfTab(c, tab);
  await c.h.fns.canvas.update({ agentId: s.id, open: true, activeItemId: tab });
  await c.h.fns.canvas.notify({ agentId: s.id });
  return null;
});
