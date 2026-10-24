// POST /speca/canvas/:tab/comments — a new comment pinned to a place in the tab; send=1 sends it to the agent now,
// otherwise it waits with the others.
import { route } from "../../web/route.ts";
import { cmJson, me, ownTab, sendToAgent } from "../../web/canvasApi.ts";

export default route(async (c) => {
  const { tab, s } = await ownTab(c);
  const f = await c.form();
  const body = String(f.body ?? "").trim();
  if (!body) return new Response("empty", { status: 400 });
  const num = (v: unknown) => Math.min(1, Math.max(0, Number(v) || 0));
  let design: Record<string, unknown> | undefined;
  if (f.design) {
    try {
      const d = JSON.parse(f.design);
      if (typeof d.file === "string" && /^[\w .()-]{1,80}\.html$/.test(d.file)) design = { file: d.file, tid: Number.isInteger(d.tid) ? d.tid : -1, path: String(d.path ?? "").slice(0, 200), fp: String(d.fp ?? "").slice(0, 80), ...(Number.isFinite(d.px) ? { px: Math.round(d.px) } : {}), ...(Number.isFinite(d.py) ? { py: Math.round(d.py) } : {}) };
    } catch { /* not a design pin */ }
  }
  const target = {
    path: String(f.path ?? "").slice(0, 500), text: String(f.text ?? "").slice(0, 300), fx: num(f.fx), fy: num(f.fy),
    ...(f.frame === "1" ? { frame: true } : {}), ...(/^https?:\/\//.test(String(f.url ?? "")) ? { url: String(f.url).slice(0, 1000) } : {}),
    ...(f.info ? { info: String(f.info).slice(0, 2500) } : {}), ...(design ? { design, file: design.file, tid: design.tid } : {}),
  };
  const cm = await c.h.fns.canvas.addComment({ itemId: tab.id, text: body, target, quote: String(f.label ?? "").slice(0, 300) || undefined, author: me(c) });
  if (f.send === "1") await sendToAgent(c, s, tab, [cm.id]);
  const fresh = (await c.h.fns.canvas.comments({ itemId: tab.id, all: true })).find((x: any) => x.id === cm.id) ?? cm;
  return Response.json(cmJson(c, fresh));
});
