// POST /speca/s/:id/stop — Stop: the agent ends its turn now.
import { route } from "../../web/route.ts";
import { chatOf } from "../../web/pages.ts";
import { stopChat } from "../../web/actions.ts";

export default route(async (c) => stopChat(c, await chatOf(c)));
