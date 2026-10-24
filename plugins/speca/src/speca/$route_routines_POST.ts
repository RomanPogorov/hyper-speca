// POST /speca/routines — a new routine: a chat started with the prompt at that time.
import { route, redirect } from "../../web/route.ts";
import { addRoutine } from "../../web/settings.ts";

export default route(async (c) => { await addRoutine(c); return redirect(c, "/speca/settings/routines"); });
