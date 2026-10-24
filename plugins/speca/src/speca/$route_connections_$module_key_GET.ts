// GET /speca/connections/:module/key — the dialog to enter a plugin's key.
import { route } from "../../web/route.ts";
import { keyDialog } from "../../web/connections.ts";

export default route(async (c) => keyDialog(c, c.params.module!));
