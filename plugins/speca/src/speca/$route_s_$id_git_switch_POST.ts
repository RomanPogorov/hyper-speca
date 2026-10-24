// POST /speca/s/:id/git/switch — switch the chat's folder to a branch, or make one (create=1).
import { route } from "../../web/route.ts";
import { gitSwitchRoute } from "../../web/code/gitOps.ts";

export default route(async (c) => gitSwitchRoute(c));
