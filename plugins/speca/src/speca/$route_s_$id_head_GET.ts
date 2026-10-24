// GET /speca/s/:id/head — the chat's header (title, status, model), refreshed live.
import { route } from "../../web/route.ts";
import { head } from "../../web/chatRoutes.ts";

export default route(head);
