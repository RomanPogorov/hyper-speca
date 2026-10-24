// GET /speca/files/:id — a file sent in a message: Hyper keeps it under its chat (/attachments/:agent/:id).
import { route } from "../../web/route.ts";

export default route(async (c) => {
  const [f] = await c.h.fns.procs.db.select({ sql: "SELECT agent_id FROM attachments WHERE id = ?", params: [c.params.id!] }) as Array<{ agent_id: string }>;
  if (!f) return new Response(c.t("common.notFound"), { status: 404 });
  return new Response(null, { status: 302, headers: { location: `/attachments/${encodeURIComponent(f.agent_id)}/${encodeURIComponent(c.params.id!)}${c.url.search}` } });
});
