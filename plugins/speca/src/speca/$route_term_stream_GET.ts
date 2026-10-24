// GET /speca/term/stream?s=<place>&cols&rows — the person's terminal as server-sent events: "replay" (recent output,
// base64) once on (re)connect, then "data" (base64) and "status" ({state, message}). Opening it starts the session.
import { route } from "../../web/route.ts";
import { attach, knownPlace, mayUse, type TermEvent } from "../../web/term.ts";

const clamp = (v: number, min: number, max: number, d: number) => (Number.isFinite(v) && v > 0 ? Math.min(max, Math.max(min, Math.round(v))) : d);

export default route(async (c) => {
  const place = c.url.searchParams.get("s") ?? "";
  const enc = new TextEncoder();
  const sse = (type: string, data: string) => enc.encode(`event: ${type}\ndata: ${data}\n\n`);
  const headers = { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" };
  if (!(await mayUse(c.h, c.user.id)) || !(await knownPlace(c.h, place))) return new Response(sse("status", JSON.stringify({ state: "closed", message: "not_yours" })), { headers });
  const size = { cols: clamp(Number(c.url.searchParams.get("cols")), 20, 400, 100), rows: clamp(Number(c.url.searchParams.get("rows")), 5, 200, 30) };
  let detach: (() => void) | null = null;
  const stream = new ReadableStream({
    async start(ctrl) {
      let first = true;
      const send = (ev: TermEvent) => {
        try {
          if (ev.type === "data") { ctrl.enqueue(sse(first ? "replay" : "data", ev.data)); first = false; }
          else { if (first) { ctrl.enqueue(sse("replay", "")); first = false; } ctrl.enqueue(sse("status", JSON.stringify({ state: ev.state, message: ev.message ?? "" }))); }
        } catch { detach?.(); }
      };
      const ping = setInterval(() => { try { ctrl.enqueue(enc.encode(": ping\n\n")); } catch { clearInterval(ping); } }, 20_000);
      try { detach = await attach(c.h, { owner: c.user.id, place, size, listener: send }); }
      catch (e) { send({ type: "status", state: "closed", message: e instanceof Error ? e.message : String(e) }); }
      c.req.signal.addEventListener("abort", () => { clearInterval(ping); detach?.(); try { ctrl.close(); } catch { /* closed */ } });
    },
    cancel() { detach?.(); },
  });
  return new Response(stream, { headers });
});
