// GET /speca/canvas/:tab/journal — the dialog with the draft's edits and the saved versions (?save focuses the name).
import { route } from "../../web/route.ts";
import { journalHtml } from "../../web/canvas.ts";
import { ownTab } from "../../web/canvasApi.ts";

export default route(async (c) => {
  const { tab } = await ownTab(c);
  return journalHtml(c, tab, { readonly: false, save: c.url.searchParams.has("save") });
});
