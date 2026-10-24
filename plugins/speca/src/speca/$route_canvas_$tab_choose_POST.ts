// POST /speca/canvas/:tab/choose — a variant chosen on a comparison: the chosen tab comes to the front and the chat
// gets the person's choice as their message.
import { route } from "../../web/route.ts";
import { say } from "../../web/actions.ts";
import { ownTab } from "../../web/canvasApi.ts";
import { withContext } from "../../web/hyper.ts";

export default route(async (c) => {
  const { tab, s } = await ownTab(c);
  if (tab.kind !== "speca.compare") throw new Error("not a comparison");
  const f = await c.form();
  const chosenId = Number(f.tabId);
  if (!(tab.args.items ?? []).some((i: any) => i.tabId === chosenId)) throw new Error(c.t("common.notFound"));
  const chosen = await c.h.fns.canvas.tab({ itemId: chosenId, agentId: s.id }).catch(() => null);
  if (!chosen) throw new Error(c.t("common.notFound"));
  await c.h.fns.canvas.update({ agentId: s.id, open: true, activeItemId: chosen.id });
  await c.h.fns.canvas.notify({ agentId: s.id });
  const text = c.t("canvas.chosen", { label: String(f.label ?? chosen.title) });
  await say(c, s, withContext(text, [`canvas tab «${chosen.title}» (tab ${chosen.id}, ${chosen.kind})`], `Chosen on the comparison «${tab.title}» (tab ${tab.id}).`), `choose:${tab.id}:${chosen.id}:${Date.now()}`);
  return null;
});
