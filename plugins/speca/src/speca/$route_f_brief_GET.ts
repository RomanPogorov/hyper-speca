// GET /speca/f/brief — the brief card again (while it is being made).
import { route } from "../../web/route.ts";
import { briefCard } from "../../web/day.ts";

export default route(async (c) => briefCard(c));
