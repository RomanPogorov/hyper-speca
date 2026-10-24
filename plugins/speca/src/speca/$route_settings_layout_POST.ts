// POST /speca/settings/layout — the layout the person chose (view, side panel, sidebar rail), kept for next time.
import { route } from "../../web/route.ts";
import { layout } from "../../web/chatSettings.ts";

export default route(layout);
