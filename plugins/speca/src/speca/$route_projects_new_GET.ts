// GET /speca/projects/new — the "New project" dialog.
import { route } from "../../web/route.ts";
import { projectNewDialog } from "../../web/projectNew.ts";

export default route(async (c) => projectNewDialog(c));
