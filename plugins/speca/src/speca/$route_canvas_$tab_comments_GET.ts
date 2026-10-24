// GET /speca/canvas/:tab/comments — the tab's open comments with their threads (?all=1: the resolved ones too).
import { route } from "../../web/route.ts";
import { cmJson, ownTab } from "../../web/canvasApi.ts";

export default route(async (c) => {
  const { tab } = await ownTab(c);
  const list = await c.h.fns.canvas.comments({ itemId: tab.id, all: c.url.searchParams.get("all") === "1" });
  return Response.json({ comments: list.map((x: any) => cmJson(c, x)) }, { headers: { "cache-control": "no-store" } });
});
