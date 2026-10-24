// GET /speca/s/:id/tab/:tab/frame — a Hyper canvas kind's body as its own page, with Hyper's styles and script.
import { route } from "../../web/route.ts";
import { chatOf } from "../../web/pages.ts";
import { framePage } from "../../web/canvas.ts";

export default route(async (c) => framePage(c, (await chatOf(c)).id, Number(c.params.tab)));
