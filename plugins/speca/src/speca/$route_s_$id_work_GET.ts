// GET /speca/s/:id/work?from&to — a folded turn's work, drawn when the person opens it.
import { route } from "../../web/route.ts";
import { work } from "../../web/chatRoutes.ts";

export default route(work);
