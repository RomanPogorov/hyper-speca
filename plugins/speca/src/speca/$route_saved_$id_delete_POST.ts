// POST /speca/saved/:id/delete — take one item out of Saved.
import { route, toast } from "../../web/route.ts";
import { removeSaved } from "../../web/saved.ts";

export default route(async (c) => { await removeSaved(c, c.params.id!); return toast(c.t("sv.removed"), "", "success", { "dh-reload": true }); });
