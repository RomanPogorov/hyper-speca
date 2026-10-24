// GET /speca/s/:id/call?from&to&id — one tool call's arguments and result.
import { route } from "../../web/route.ts";
import { call } from "../../web/chatRoutes.ts";

export default route(call);
