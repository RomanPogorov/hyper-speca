// GET /speca — Speca's home: the person's latest chat (a new one when there is none yet).
import { route, redirect } from "../../web/route.ts";
import { listSessions } from "../../web/hyper.ts";

export default route(async (c) => {
  const [last] = await listSessions(c.h, c.user.id, { limit: 1 });
  if (last) return redirect(c, `/speca/s/${last.id}`);
  const made = await c.h.fns.agent.createFromValues({});
  if (made.error || !made.agent) throw new Error(made.error ?? "could not start a chat");
  return redirect(c, `/speca/s/${made.agent.id}`);
});
