// POST /speca/settings/default-model — the model new chats start on.
import { route, redirect } from "../../web/route.ts";
import { saveDefaultModel } from "../../web/settings.ts";

export default route(async (c) => { await saveDefaultModel(c); return redirect(c, "/speca/settings/models?saved=1"); });
