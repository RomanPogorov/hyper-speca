// GET /speca/coordinator — the person's coordinator chat (made the first time).
import { route, redirect } from "../../web/route.ts";
import { coordinatorId } from "../../web/day.ts";

export default route(async (c) => redirect(c, `/speca/s/${await coordinatorId(c)}`));
