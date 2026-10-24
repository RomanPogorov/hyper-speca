// GET /speca/settings — the person's profile (web/settings.ts).
import { route } from "../../web/route.ts";
import { profilePage } from "../../web/settings.ts";

export default route(async (c) => profilePage(c));
