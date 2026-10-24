// POST /speca/s/:id/effort — how hard the model thinks in this chat.
import { route } from "../../web/route.ts";
import { chatOf } from "../../web/pages.ts";
import { setEffort } from "../../web/chatSettings.ts";

export default route(async (c) => setEffort(c, await chatOf(c)));
