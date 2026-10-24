// POST /speca/canvas/:tab/edit — the person's own text of a document (markdown), written into the draft as their edit.
import { route } from "../../web/route.ts";
import { me, ownTab } from "../../web/canvasApi.ts";

export default route(async (c) => {
  const { tab } = await ownTab(c);
  if (tab.kind !== "speca.doc") throw new Error("only a document is edited by hand");
  const markdown = String((await c.form()).markdown ?? "");
  if (markdown !== String(tab.args.markdown ?? "")) {
    await c.h.fns.canvas.write({ itemId: tab.id, args: { ...tab.args, markdown }, note: "edited by hand", author: me(c) });
  }
  return null;
});
