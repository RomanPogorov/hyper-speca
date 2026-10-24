// POST /speca/term/input — keystrokes ({s, d}) and the window's size ({s, cols, rows}) for the person's own session.
import { route } from "../../web/route.ts";
import { mayUse, resize, write } from "../../web/term.ts";

export default route(async (c) => {
  if (!(await mayUse(c.h, c.user.id))) return new Response("not found", { status: 404 });
  const b = (await c.req.json().catch(() => ({}))) as { s?: string; d?: string; cols?: number; rows?: number };
  if (!b.s) return new Response("not found", { status: 404 });
  if (typeof b.d === "string") {
    if (b.d.length > 64 * 1024) return new Response("too long", { status: 413 });
    return write(c.user.id, b.s, b.d) ? null : new Response("closed", { status: 409 });
  }
  if (Number.isInteger(b.cols) && Number.isInteger(b.rows)) resize(c.user.id, b.s, Math.min(400, Math.max(20, b.cols!)), Math.min(200, Math.max(5, b.rows!)));
  return null;
});
