// POST /speca/s/:id/git/pr — open a pull request of the branch (gh), or find the open one.
import { route } from "../../web/route.ts";
import { gitPrRoute } from "../../web/code/gitOps.ts";

export default route(async (c) => gitPrRoute(c));
