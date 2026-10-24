// GET /speca/s/:id/git/branch — the "New branch" dialog.
import { route } from "../../web/route.ts";
import { gitBranchDialog } from "../../web/code/gitOps.ts";

export default route(async (c) => gitBranchDialog(c));
