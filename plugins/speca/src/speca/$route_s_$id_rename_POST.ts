// POST /speca/s/:id/rename — the chat's name.
import { route } from "../../web/route.ts";
import { chatOf } from "../../web/pages.ts";
import { rename } from "../../web/chatSettings.ts";

export default route(async (c) => rename(c, await chatOf(c)));
