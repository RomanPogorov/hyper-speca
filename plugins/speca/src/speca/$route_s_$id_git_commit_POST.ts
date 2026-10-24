// POST /speca/s/:id/git/commit — commit the chosen files as the person.
import { route } from "../../web/route.ts";
import { gitCommitRoute } from "../../web/code/gitOps.ts";

export default route(async (c) => gitCommitRoute(c));
