// POST /speca/canvas/:tab/reopen — bring a closed tab back, with its state.
import { route } from "../../web/route.ts";
import { chatOfTab } from "../../web/canvas.ts";

export default route(async (c) => {
  const tab = Number(c.params.tab);
  const s = await chatOfTab(c, tab);
  await c.h.fns.canvas.reopen({ agentId: s.id, itemId: tab });
  return null;
});
