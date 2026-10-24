// POST /speca/settings/keys — API keys of model providers (an empty field keeps the key there is).
import { route, redirect } from "../../web/route.ts";
import { saveKeys } from "../../web/settings.ts";

export default route(async (c) => { await saveKeys(c); return redirect(c, "/speca/settings/models?saved=1"); });
