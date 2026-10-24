// POST /speca/connections/:module/remove — forget the keys kept for a plugin.
import { route, toast } from "../../web/route.ts";
import { removeKeys } from "../../web/connections.ts";

export default route(async (c) => { await removeKeys(c, c.params.module!); return toast(c.t("conn.removed"), "", "success", { "dh-reload": true }); });
