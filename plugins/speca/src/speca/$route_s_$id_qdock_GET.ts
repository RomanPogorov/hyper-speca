// GET /speca/s/:id/qdock — the dock above the composer (messages waiting for the agent).
import { route } from "../../web/route.ts";
import { qdock } from "../../web/chatRoutes.ts";

export default route(qdock);
