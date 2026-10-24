// POST /speca/s/:id/model — switch the chat's model (it also becomes the default for new chats).
import { route } from "../../web/route.ts";
import { chatOf } from "../../web/pages.ts";
import { setModel } from "../../web/chatSettings.ts";

export default route(async (c) => setModel(c, await chatOf(c)));
