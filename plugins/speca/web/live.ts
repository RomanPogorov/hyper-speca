//   canvas.changed     (global, names its agent) a tab opened, closed, changed → canvas:<id>
// One live stream per browser tab (GET /speca/events?topics=…): Speca's app.js listens for `event: live` with a topic
// and refreshes the regions marked data-live-topic. The topics come from Hyper's bus, as they happen:
//   agent:<id>         the chat changed (a message, a tool, a turn, the canvas) → session:<id>, canvas:<id>, sub:<id>, user:<me>
//   agent:<id>:stream  its reply is being written                            → session:<id>
//   agents / plugins   the list of chats or plugins changed                  → user:<me>, org, sub:<each>
import type { Ctx } from "./route.ts";

export function liveStream(c: Ctx): Response {
  const want = new Set((c.url.searchParams.get("topics") ?? "").split(",").map((x) => x.trim()).filter(Boolean));
  const sessions = [...want].filter((t) => t.startsWith("session:") || t.startsWith("canvas:") || t.startsWith("comments:")).map((t) => t.slice(t.indexOf(":") + 1));
  const ids = [...new Set(sessions)];
  const enc = new TextEncoder();
  let stop: Array<() => void> = [];
  let ping: ReturnType<typeof setInterval> | null = null;
  // the reply streams many times a second: one refresh per ~250 ms is enough for the eye and the server
  const pending = new Set<string>();
  let flush: ReturnType<typeof setTimeout> | null = null;
  const end = () => { stop.forEach((u) => { try { u(); } catch { /* gone */ } }); stop = []; if (ping) clearInterval(ping); if (flush) clearTimeout(flush); ping = flush = null; };
  const stream = new ReadableStream({
    start(ctrl) {
      const write = (s: string) => { try { ctrl.enqueue(enc.encode(s)); } catch { end(); } };
      const send = (topic: string) => {
        if (!want.has(topic)) return;
        pending.add(topic);
        flush ??= setTimeout(() => { flush = null; for (const t of pending) write(`event: live\ndata: ${t}\n\n`); pending.clear(); }, 120);
      };
      write(`retry: 2000\n\n`);
      // a timeline (web/timeline.ts) redraws when its chat changes and when its entries are described
      const tls = [...want].filter((t) => t.startsWith("timeline:")).map((t) => t.slice(9));
      const topics = [...ids.flatMap((id) => [`agent:${id}`, `agent:${id}:stream`]), ...tls.map((id) => `speca:timeline:${id}`), "agents", "plugins"];
      stop.push(c.h.fns.procs.events.subscribe({
        topics,
        handler: (e: any) => {
          const t = String(e?.topic ?? "");
          // canvas.changed is global (no topic) and names its agent
          if (!t && e?.type === "canvas.changed") { const id = String(e.agentId ?? ""); if (ids.includes(id)) { send(`canvas:${id}`); send(`comments:${id}`); } return; }
          if (t.startsWith("speca:timeline:")) { send(`timeline:${t.slice(15)}`); return; }
          if (t.startsWith("agent:") && t.endsWith(":stream")) send(`session:${t.slice(6, -7)}`);
          else if (t.startsWith("agent:")) {
            const id = t.slice(6);
            send(`session:${id}`); send(`canvas:${id}`); send(`sub:${id}`); send(`user:${c.user.id}`);
          } else if (t === "agents") { send(`user:${c.user.id}`); send("org"); for (const id of ids) send(`sub:${id}`); }
          else if (t === "plugins") send(`user:${c.user.id}`);
        },
      }));
      ping = setInterval(() => write(`: ping\n\n`), 20_000);
    },
    cancel: end,
  });
  c.req.signal?.addEventListener("abort", end);
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" } });
}
