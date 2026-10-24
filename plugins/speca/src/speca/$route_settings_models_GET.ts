// GET /speca/settings/models — subscriptions, the default model, my API keys (web/settings.ts).
import { route } from "../../web/route.ts";
import { modelsPage } from "../../web/settings.ts";

export default route(async (c) => modelsPage(c));
