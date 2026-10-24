// GET /speca/events?topics=… — the page's live stream (server-sent events) from Hyper's bus.
import { route } from "../../web/route.ts";
import { liveStream } from "../../web/live.ts";

export default route(liveStream);
