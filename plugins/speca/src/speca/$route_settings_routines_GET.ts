// GET /speca/settings/routines — the agent's work on a schedule (web/settings.ts).
import { route } from "../../web/route.ts";
import { routinesPage } from "../../web/settings.ts";

export default route(async (c) => routinesPage(c));
