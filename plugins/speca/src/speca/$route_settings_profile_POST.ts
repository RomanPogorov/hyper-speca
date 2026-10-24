// POST /speca/settings/profile — name, title, language, time zone, theme.
import { route, redirect } from "../../web/route.ts";
import { saveProfile } from "../../web/settings.ts";

export default route(async (c) => { await saveProfile(c); return redirect(c, "/speca/settings?saved=1"); });
