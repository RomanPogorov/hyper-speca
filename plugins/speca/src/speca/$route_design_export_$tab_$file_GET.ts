// GET /speca/design/export/:tab/:file — one artboard as a standalone HTML file to download.
import { route } from "../../web/route.ts";
import { designTab } from "../../web/design/routes.ts";
import { boardHtml } from "../../web/design/export.ts";
import { FILE } from "../../web/design/model.ts";

export default route(async (c) => {
  const { state } = await designTab(c);
  const file = c.params.file ?? "";
  if (!FILE.test(file) || !state.boards[file]) return new Response("not found", { status: 404 });
  const name = state.boards[file]!.title.replace(/[^\p{L}\p{N} _-]+/gu, " ").trim() || "artboard";
  return new Response(boardHtml(state, file), { headers: { "content-type": "text/html; charset=utf-8", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}.html`, "cache-control": "no-store" } });
});
