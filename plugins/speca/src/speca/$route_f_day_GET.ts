// GET /speca/f/day — My day again (live refresh).
import { route } from "../../web/route.ts";
import { dayHtml } from "../../web/day.ts";

export default route(async (c) => dayHtml(c));
