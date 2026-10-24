// POST /speca/saved — keep a note typed on the page, or a chat's message ("Save" under an answer).
import { route, toast } from "../../web/route.ts";
import { addSaved } from "../../web/saved.ts";

export default route(async (c) => { await addSaved(c); return toast(c.t("saved.added"), "", "success", c.req.headers.get("hx-current-url")?.includes("/speca/saved") ? { "dh-reload": true } : {}); });
