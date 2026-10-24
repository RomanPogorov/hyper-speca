// GET /speca/s/:id — a chat: the sidebar, the chat with its turns and composer, the canvas beside it.
import { route } from "../../web/route.ts";
import { chatOf, sessionPage } from "../../web/pages.ts";

export default route(async (c) => sessionPage(c, await chatOf(c)));
