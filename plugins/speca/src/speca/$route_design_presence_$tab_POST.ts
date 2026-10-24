// POST /speca/design/presence/:tab — where I am on this design canvas (cursor, selection; null: I left); answers with
// the others.
import { route } from "../../web/route.ts";
import { designTab, jsonBody, bad } from "../../web/design/routes.ts";
import { announce, peers } from "../../web/design/presence.ts";

export default route(async (c) => {
  const { tab } = await designTab(c);
  const b = await jsonBody(c);
  if (!b || !("state" in b)) return bad();
  announce(tab.id, { userId: c.user.id, name: c.user.name ?? c.user.id }, b.state);
  return Response.json({ people: peers(tab.id, c.user.id) });
});
