// POST /speca/canvas/:tab/versions/:v/name — name a saved version (an empty name takes it away).
import { route } from "../../web/route.ts";
import { ownTab } from "../../web/canvasApi.ts";

export default route(async (c) => {
  const { tab } = await ownTab(c);
  await c.h.fns.canvas.renameVersion({ itemId: tab.id, v: Number(c.params.v), name: String((await c.form()).name ?? "").trim() });
  return null;
});
