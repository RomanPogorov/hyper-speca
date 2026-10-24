// POST /speca/s/:id/canvas/new — "+" → "Create with the agent": a fresh document or table tab that keeps versions
// (Speca's creatable canvases); the agent sees it on its canvas and fills it when asked.
import { route } from "../../web/route.ts";
import { chatOf } from "../../web/pages.ts";

const START: Record<string, { args: Record<string, unknown>; ru: string; en: string }> = {
  "speca.doc": { args: { markdown: "# Draft\n\n" }, ru: "Документ", en: "Document" },
  "speca.table": { args: { columns: ["Name", "Value"], rows: [] }, ru: "Таблица", en: "Table" },
};

export default route(async (c) => {
  const s = await chatOf(c);
  const kind = String((await c.form()).kind ?? "");
  const k = START[kind];
  if (!k) throw new Error("unknown canvas");
  const tab = await c.h.fns.canvas.show({ agentId: s.id, kind, args: k.args, title: c.t.locale === "ru" ? k.ru : k.en });
  await c.h.fns.canvas.update({ agentId: s.id, open: true, activeItemId: tab.id });
  await c.h.fns.canvas.notify({ agentId: s.id });
  return null;
});
