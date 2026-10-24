// GET /speca/s/:id/log?after=N | ?before=N — the log's tail since N (live refresh) or an older page of turns.
import { route } from "../../web/route.ts";
import { log } from "../../web/chatRoutes.ts";

export default route(log);
