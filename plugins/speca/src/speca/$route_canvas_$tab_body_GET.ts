// GET /speca/canvas/:tab/body — the tab's body: the draft, a saved version (?v=N), a moment of the draft (?at=n),
// or two of them compared (?compare=1). The history drawer and the journal load it into #cbody.
import { route } from "../../web/route.ts";
import { tabBody } from "../../web/canvas.ts";
import { ownTab } from "../../web/canvasApi.ts";

export default route(async (c) => {
  const { tab, s } = await ownTab(c);
  const q = c.url.searchParams;
  return tabBody(c, s, tab, { v: Number(q.get("v")) || undefined, compare: q.has("compare"), at: Number(q.get("at")) || undefined });
});
