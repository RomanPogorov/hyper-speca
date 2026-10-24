// POST /speca/canvas/:tab/commit — save the draft as the next version, with an optional name.
import { route, toast } from "../../web/route.ts";
import { me, ownTab } from "../../web/canvasApi.ts";

export default route(async (c) => {
  const { tab } = await ownTab(c);
  const name = String((await c.form()).name ?? "").trim();
  const r = await c.h.fns.canvas.commit({ itemId: tab.id, name: name || undefined, author: me(c) });
  return r.committed ? toast(c.t("canvas.saved", { v: r.v })) : null;
});
