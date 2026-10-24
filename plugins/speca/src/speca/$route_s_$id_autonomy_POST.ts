// POST /speca/s/:id/autonomy — what the agent may do without asking (read only, ask, drafts, full).
import { route } from "../../web/route.ts";
import { chatOf } from "../../web/pages.ts";
import { setAutonomy } from "../../web/chatSettings.ts";

export default route(async (c) => setAutonomy(c, await chatOf(c)));
