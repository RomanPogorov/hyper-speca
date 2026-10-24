// POST /speca/brief/run — make the brief now (the routine is made first when there is none), then its card.
import { route } from "../../web/route.ts";
import { briefCard, runBrief } from "../../web/day.ts";

export default route(async (c) => { await runBrief(c); return briefCard(c); });
