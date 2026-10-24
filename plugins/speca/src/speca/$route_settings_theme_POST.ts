// POST /speca/settings/theme — light, dark or as the system.
import { route } from "../../web/route.ts";
import { theme } from "../../web/chatSettings.ts";

export default route(theme);
