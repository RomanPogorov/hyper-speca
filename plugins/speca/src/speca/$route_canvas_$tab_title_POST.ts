// POST /speca/canvas/:tab/title — rename a tab in place (double click or F2 on it in the strip).
import { route } from "../../web/route.ts";
import { chatOfTab } from "../../web/canvas.ts";

export default route(async (c) => {
  const tab = Number(c.params.tab);
  const s = await chatOfTab(c, tab);
  const title = String((await c.form()).title ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!title) throw new Error(c.t("canvas.renameTab"));
  await c.h.fns.canvas.write({ itemId: tab, agentId: s.id, title, note: `renamed: ${title}`, author: `user:${c.user.id}` });
  return null;
});
