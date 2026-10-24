// POST /speca/s/:id/canvas/close — close all tabs (or all but `except`): the tab menu's "Close others / Close all".
import { route } from "../../web/route.ts";
import { chatOf } from "../../web/pages.ts";
import { tabsOf } from "../../web/canvas.ts";

export default route(async (c) => {
  const s = await chatOf(c);
  const keep = Number((await c.form()).except) || null;
  for (const tab of await tabsOf(c, s.id)) if (tab.id !== keep) await c.h.fns.canvas.close({ agentId: s.id, itemId: tab.id });
  return null;
});
