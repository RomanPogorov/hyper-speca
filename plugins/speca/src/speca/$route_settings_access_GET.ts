// GET /speca/settings/access — my agent: its rules, the access new chats start with (web/settings.ts).
import { route } from "../../web/route.ts";
import { accessPage } from "../../web/settings.ts";

export default route(async (c) => accessPage(c));
