// GET /speca/f/search?q= — chats found by their words.
import { route } from "../../web/route.ts";
import { appShim } from "../../web/hyper.ts";
import { searchResults } from "../../web/views/sidebar.ts";

export default route(async (c) => searchResults(appShim, c.user, c.t, (c.url.searchParams.get("q") ?? "").slice(0, 200)));
