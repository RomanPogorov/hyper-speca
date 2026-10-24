// GET /speca/design/export/:tab — all artboards of a design canvas as one HTML page to download (print it to PDF).
import { route } from "../../web/route.ts";
import { designTab } from "../../web/design/routes.ts";
import { allHtml } from "../../web/design/export.ts";

export default route(async (c) => {
  const { tab, state } = await designTab(c);
  const name = (state.title || tab.title || "design").replace(/[^\p{L}\p{N} _-]+/gu, " ").trim() || "design";
  return new Response(allHtml(state), { headers: { "content-type": "text/html; charset=utf-8", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}.html`, "cache-control": "no-store" } });
});
