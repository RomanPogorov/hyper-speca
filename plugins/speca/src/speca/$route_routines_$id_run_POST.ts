// POST /speca/routines/:id/run — run a routine now (a new chat).
import { route, toast } from "../../web/route.ts";
import { runRoutine } from "../../web/settings.ts";

export default route(async (c) => { await runRoutine(c, c.params.id!); return toast(c.t("set.started")); });
