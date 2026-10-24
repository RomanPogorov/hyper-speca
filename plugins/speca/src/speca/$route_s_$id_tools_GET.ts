// GET /speca/s/:id/tools?from&to&group — one group of tool calls inside a turn.
import { route } from "../../web/route.ts";
import { tools } from "../../web/chatRoutes.ts";

export default route(tools);
