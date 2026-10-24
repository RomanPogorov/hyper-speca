// POST /speca/s/:id/pin — pin the chat to the top of the sidebar (or unpin).
import { route } from "../../web/route.ts";
import { chatOf } from "../../web/pages.ts";
import { pin } from "../../web/chatSettings.ts";

export default route(async (c) => pin(c, await chatOf(c)));
