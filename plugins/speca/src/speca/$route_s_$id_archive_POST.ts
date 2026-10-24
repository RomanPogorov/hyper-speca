// POST /speca/s/:id/archive — stop and put the chat away (search still finds it).
import { route } from "../../web/route.ts";
import { chatOf } from "../../web/pages.ts";
import { archive } from "../../web/chatSettings.ts";

export default route(async (c) => archive(c, await chatOf(c)));
