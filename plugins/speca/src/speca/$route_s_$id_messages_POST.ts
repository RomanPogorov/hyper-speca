// POST /speca/s/:id/messages — the composer sends: text and attachments become the agent's next message.
import { route } from "../../web/route.ts";
import { chatOf } from "../../web/pages.ts";
import { sendMessage } from "../../web/actions.ts";

export default route(async (c) => sendMessage(c, await chatOf(c)));
