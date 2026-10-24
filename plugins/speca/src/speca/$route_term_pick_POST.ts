// POST /speca/term/pick {tab, s} — a terminal tab opened without a place: the person picked one; the tab remembers it.
import { route } from "../../web/route.ts";
import { chatOfTab } from "../../web/canvas.ts";
import { knownPlace, MAC, T } from "../../web/term.ts";

export default route(async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { tab?: string | number; s?: string };
  const tab = Number(b.tab);
  if (!tab || !b.s || !(await knownPlace(c.h, b.s))) return new Response("not found", { status: 404 });
  const s = await chatOfTab(c, tab);
  const t = T(c.t.locale);
  await c.h.fns.canvas.setState({ agentId: s.id, itemId: tab, state: { server: b.s } });
  await c.h.fns.procs.db.run({ sql: "UPDATE canvas_items SET title = ? WHERE id = ?", params: [`${t.title} · ${b.s === MAC ? t.mac : b.s}`, tab] });
  return null;
});
