// GET /speca/day — My day (web/day.ts).
import { route } from "../../web/route.ts";
import { ownPage } from "../../web/pages.ts";
import { dayHtml } from "../../web/day.ts";

export default route(async (c) => ownPage(c, { title: c.t("slot.day"), page: "day", body: await dayHtml(c) }));
