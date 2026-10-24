// GET /speca/admin — the workspace's administration is Hyper's own settings page.
import { route } from "../../web/route.ts";

export default route(async () => new Response(null, { status: 302, headers: { location: "/settings" } }));
