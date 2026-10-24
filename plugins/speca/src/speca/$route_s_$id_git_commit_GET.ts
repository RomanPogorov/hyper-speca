// GET /speca/s/:id/git/commit — the commit dialog: a message and the files to commit.
import { route } from "../../web/route.ts";
import { gitCommitDialog } from "../../web/code/gitOps.ts";

export default route(async (c) => gitCommitDialog(c));
