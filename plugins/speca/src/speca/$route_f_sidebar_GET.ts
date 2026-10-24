// GET /speca/f/sidebar?s=&p= — the sidebar, refreshed live when chats change.
import { route } from "../../web/route.ts";
import { appShim } from "../../web/hyper.ts";
import { closedOf, sidebar } from "../../web/views/sidebar.ts";

export default route(async (c) => sidebar(appShim, c.user, c.t, { session: c.url.searchParams.get("s") || null, page: c.url.searchParams.get("p") || null, closed: closedOf(c.req) }));
