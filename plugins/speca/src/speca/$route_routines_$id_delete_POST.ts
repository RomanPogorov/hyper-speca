// POST /speca/routines/:id/delete — remove a routine.
import { route, redirect } from "../../web/route.ts";
import { removeRoutine } from "../../web/settings.ts";

export default route(async (c) => { await removeRoutine(c, c.params.id!); return redirect(c, "/speca/settings/routines"); });
