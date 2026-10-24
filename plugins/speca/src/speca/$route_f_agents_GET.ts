// GET /speca/f/agents — the Agents page body, as it asks for itself again (live signals, every few seconds while anyone works).
import { route } from "../../web/route.ts";
import { agentsHtml } from "../../web/views/agents.ts";

export default route(async (c) => agentsHtml(c.h, c.user, c.t));
