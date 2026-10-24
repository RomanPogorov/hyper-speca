// GET /speca/s/:id/canvas — the canvas beside the chat (tab strip and the active tab), refreshed live.
import { route } from "../../web/route.ts";
import { chatOf } from "../../web/pages.ts";
import { canvasHtml } from "../../web/canvas.ts";

export default route(async (c) => canvasHtml(c, await chatOf(c)));
