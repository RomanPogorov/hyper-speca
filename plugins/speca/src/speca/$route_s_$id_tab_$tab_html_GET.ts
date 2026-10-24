// GET /speca/s/:id/tab/:tab/html — an html tab's sandboxed page (Hyper's canvas.htmlFrame, same CSP and sandbox),
// framable by local pages too: Speca's app shown through a local preview proxy frames it from the proxy's address.
import { route } from "../../web/route.ts";
import { chatOf } from "../../web/pages.ts";

const ANCESTORS = "frame-ancestors 'self' http://localhost:* http://*.localhost:* http://127.0.0.1:*";

export default route(async (c) => {
  const s = await chatOf(c);
  const q = c.url.searchParams;
  const r: Response = await c.h.fns.canvas.htmlFrame({ agentId: s.id, itemId: Number(c.params.tab), v: Number(q.get("ver")) || undefined, edit: Number(q.get("at")) || undefined });
  const headers = new Headers(r.headers);
  const csp = headers.get("content-security-policy");
  if (csp) headers.set("content-security-policy", csp.replace(/frame-ancestors [^;]*/, ANCESTORS));
  return new Response(r.body, { status: r.status, headers });
});
