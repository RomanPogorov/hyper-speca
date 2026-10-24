// POST /speca/connections/:module/key — keep a plugin's key (an empty field keeps the one there is).
import { route, toast } from "../../web/route.ts";
import { saveKey } from "../../web/connections.ts";

export default route(async (c) => { await saveKey(c, c.params.module!); return toast(c.t("common.saved"), "", "success", { "dh-close-dialog": true, "dh-reload": true }); });
