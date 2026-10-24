// POST /speca/canvas/:tab/focus {focus?} — bring a tab to the front (reopened if it was closed), on the artboard named
// by `focus` (a design canvas): the way from the chat's "places" and the timeline's marks to the canvas.
import { route } from "../../web/route.ts";
import { chatOfTab } from "../../web/canvas.ts";

export default route(async (c) => {
  const tab = Number(c.params.tab);
  const s = await chatOfTab(c, tab);
  const f = String((await c.form()).focus ?? "").slice(0, 200);
  await c.h.fns.canvas.reopen({ agentId: s.id, itemId: tab }).catch(() => {});
  if (f) {
    const item: any = await c.h.fns.canvas.tab({ agentId: s.id, itemId: tab }).catch(() => null);
    if (item?.kind === "speca.design") await c.h.fns.canvas.setState({ agentId: s.id, itemId: tab, state: { focus: { target: f, at: Date.now() } } }).catch(() => {});
  }
  await c.h.fns.canvas.update({ agentId: s.id, open: true, activeItemId: tab });
  await c.h.fns.canvas.notify({ agentId: s.id });
  return null;
});
