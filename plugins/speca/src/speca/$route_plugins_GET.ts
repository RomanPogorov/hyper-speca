// GET /speca/plugins — the plugins dialog (web/plugins.ts); opened as a page when asked for directly.
import { route } from "../../web/route.ts";
import { ownPage } from "../../web/pages.ts";
import { pluginsDialog } from "../../web/plugins.ts";

export default route(async (c) => c.hx ? pluginsDialog(c) : ownPage(c, { title: c.t("sb.plugins"), page: "plugins", body: await pluginsDialog(c) }));
