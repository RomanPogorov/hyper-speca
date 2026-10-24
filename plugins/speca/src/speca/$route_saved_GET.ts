// GET /speca/saved — the person's Saved (web/saved.ts).
import { route } from "../../web/route.ts";
import { ownPage } from "../../web/pages.ts";
import { savedHtml } from "../../web/saved.ts";

export default route(async (c) => ownPage(c, { title: c.t("term.saved"), page: "saved", body: await savedHtml(c) }));
