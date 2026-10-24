// GET /speca/design/presence/:tab — the others on this design canvas (their cursor and selection).
import { route } from "../../web/route.ts";
import { designTab } from "../../web/design/routes.ts";
import { peers } from "../../web/design/presence.ts";

export default route(async (c) => {
  const { tab } = await designTab(c);
  return Response.json({ people: peers(tab.id, c.user.id) });
});
