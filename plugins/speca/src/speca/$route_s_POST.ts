// POST /speca/s — New chat (optionally with its first message), then open it.
import { route } from "../../web/route.ts";
import { newChat } from "../../web/actions.ts";

export default route(newChat);
