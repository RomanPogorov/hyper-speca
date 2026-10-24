// POST /speca/settings/agent — my agent's rules, or its default access and irreversible actions.
import { route, redirect } from "../../web/route.ts";
import { saveAgent } from "../../web/settings.ts";

export default route(async (c) => { await saveAgent(c); return redirect(c, "/speca/settings/access?saved=1"); });
