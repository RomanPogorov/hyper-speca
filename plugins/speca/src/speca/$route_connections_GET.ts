// GET /speca/connections — the person's systems: subscriptions, Google, plugins with a key (web/connections.ts).
import { route } from "../../web/route.ts";
import { ownPage } from "../../web/pages.ts";
import { connectionsHtml } from "../../web/connections.ts";

export default route(async (c) => ownPage(c, { title: c.t("sb.connections"), page: "connections", body: await connectionsHtml(c) }));
