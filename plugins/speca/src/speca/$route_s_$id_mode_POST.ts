// POST /speca/s/:id/mode — plan first, or work.
import { route } from "../../web/route.ts";
import { chatOf } from "../../web/pages.ts";
import { setMode } from "../../web/chatSettings.ts";

export default route(async (c) => setMode(c, await chatOf(c)));
