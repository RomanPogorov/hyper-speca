// POST /speca/term/close {s} — the person ends their session on a place ("End the session").
import { route } from "../../web/route.ts";
import { close } from "../../web/term.ts";

export default route(async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { s?: string };
  if (b.s) close(c.user.id, b.s);
  return null;
});
