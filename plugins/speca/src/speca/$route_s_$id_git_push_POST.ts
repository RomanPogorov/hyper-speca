// POST /speca/s/:id/git/push — push the branch to origin (the machine's git sign-in).
import { route } from "../../web/route.ts";
import { gitPushRoute } from "../../web/code/gitOps.ts";

export default route(async (c) => gitPushRoute(c));
