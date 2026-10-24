// "Agents", as in Speca (core/web/views/agents.ts + core/runtime/agents.ts), on Hyper's agents: figures (at work,
// waiting for the person, finished lately), then a card per chat at work (k.ticket) — those that wait for the person
// first: its project, state and time, its task, how far by its plan, what it needs from the person (a confirmation or a
// plan decided right there — an irreversible one in red with its command; a question answered in its chat; a
// subagent's, on its parent's card), its model and tokens, open and stop; those finished in the last hours under a cut.
import { html, join, type Raw } from "../html.ts";
import * as k from "../ui/kit.ts";
import { rel } from "../fmt.ts";
import { prettyModel, type T, type UserRow } from "../types.ts";
import { listSessions, projects as loadProjects, type HSession } from "../hyper.ts";
import { pending } from "../approvals.ts";
import { firstLine, tkBtn, tkProgress, tkUsage } from "../subs.ts";

const RECENT_H = 6;
type Need = Awaited<ReturnType<typeof pending>>[number] & { subName: string | null };
type Card = { s: HSession; project: string | null; asked: string; said: string; fresh: number; cached: number; subs: { live: number; total: number } };

// what it was asked, without the names of files attached to the message and with links as their text
const asked = (s: string) => s.replace(/\[([^\]\n]{1,200})\]\([^)\s]{1,500}\)/g, "$1 ").replace(/\[[^\]\n]{1,80}\.[a-z0-9]{2,5}\]\s*/gi, "").replace(/\s{2,}/g, " ").trim();

const tkDecide = (t: T, id: string, hash: string, crit = false) => {
  const vals = (decision: string) => html`hx-post="/speca/approvals/${id}" hx-vals='${JSON.stringify({ hash, decision })}' hx-swap="none"`;
  return html`${k.button({ label: t("tk.approve"), variant: crit ? "destructive" : "primary", size: "sm", attrs: html`data-tk="go" ${vals("approved")}` })}${k.button({ label: t("tk.reject"), variant: "outline", size: "sm", attrs: vals("rejected") })}`;
};

/** What waits for the person on a card: a confirmation or a plan (decided right there), a question (in its chat). */
function tkAsk(t: T, n: Need, more: number, reply: Raw) {
  const kind = n.kind === "plan" ? "plan" : n.kind === "question" ? "question" : "approval";
  const crit = kind === "approval" && n.effect === "irreversible";
  const tail = more ? ` · ${t("tk.more", { n: more })}` : "";
  const who = (s: string) => (n.subName ? `${n.subName}: ${s}` : s);
  // a subagent's confirmation is decided on its own card in the chat; a question is answered there too
  const actions = kind !== "question" && !n.subName ? tkDecide(t, n.id, n.preview_hash, crit) : reply;
  if (crit) {
    const line = [n.items[0], n.summary].find((x) => x?.startsWith("$ "));
    const cmd = line?.slice(2);
    return { crit, ask: { label: t("tk.ask.irrev") + tail, text: cmd ? n.subName ?? undefined : who(n.summary), cmd, risk: t("tk.ask.risk"), actions } };
  }
  return { crit, ask: { label: t(`tk.ask.${kind}` as never) + tail, text: who(n.summary || t(`agents.need.${kind}` as never)), actions } };
}

function card(t: T, a: Card, needs: Need[]): Raw {
  const s = a.s;
  const mine = needs.filter((n) => n.chat_id === s.id);
  const n = mine[0];
  const working = s.status === "running" || s.status === "waiting" || a.subs.live > 0;
  const tone: k.TicketTone = n ? "needs" : working ? "run" : s.status === "error" ? "bad" : "idle";
  const state = t(n ? (n.kind === "question" ? "tk.st.answer" : "tk.st.decide") : s.status === "running" ? "tk.st.run" : a.subs.live ? "tk.st.subs" : s.status === "error" ? "tk.st.bad" : "tk.st.idle");
  const href = `/speca/s/${s.id}`;
  const need = n ? tkAsk(t, n, mine.length - 1, k.button({ label: t("tk.reply"), size: "sm", href: n.agent_id !== s.id ? `${href}?sub=${n.agent_id}` : href, attrs: html`data-tk="go"` })) : null;
  const progress = tkProgress(t, s.plan ?? [], { working: working && !n, over: null, idle: s.status !== "running" && a.subs.live ? t("agents.subsWork", { n: a.subs.live }) : undefined });
  const said = !n && !working ? firstLine(a.said) : "";
  return k.ticket({
    tone, crit: need?.crit, where: { icon: "folder", text: a.project ?? t("tk.noProject") }, state, time: rel(s.updated_at, t.locale),
    title: s.title || asked(a.asked) || t("chat.newChat"), href, hint: asked(a.asked) || undefined, progress, ask: need?.ask,
    note: said ? { label: t(s.status === "error" ? "tk.slot.failed" : "tk.slot.last"), text: said, bad: s.status === "error" } : null,
    model: prettyModel(s.model), usage: tkUsage(t, a.fresh, a.cached),
    tools: html`${a.subs.total ? tkBtn("bot", t("agents.board"), { attrs: html`hx-post="/speca/s/${s.id}/subs/canvas" hx-swap="none"` }) : ""}${tkBtn("arrowUR", t("tk.openChat"), { href })}${working ? tkBtn("square", t("tk.stop"), { tk: "stop", attrs: html`hx-post="/speca/s/${s.id}/stop" hx-swap="none"` }) : ""}`,
    attrs: html`data-agent="${s.id}"`,
  });
}

/** A chat whose agent finished lately: one quiet row — its title, when, where, on which model — that opens it. */
function recentRow(t: T, a: Card): Raw {
  const subs = a.subs.total ? t("agents.subsN", { n: a.subs.total }) : "";
  return k.row({ tag: "a", href: `/speca/s/${a.s.id}`, icon: a.s.workspace_dir ? "terminal" : "check", title: a.s.title || asked(a.asked) || t("chat.newChat"),
    meta: [t("agents.finishedAgo", { ago: rel(a.s.updated_at, t.locale) }), a.project ?? "", prettyModel(a.s.model), subs].filter(Boolean).join(" · ") });
}

/** The chats at work and those finished lately, with what they were asked, said and spent (their subagents' too). */
async function overview(h: any, me: UserRow) {
  const all = await listSessions(h, me.id, { limit: 500 });
  const top = all.filter((s) => s.kind !== "subagent");
  const subsBy = new Map<string, HSession[]>();
  for (const s of all) if (s.kind === "subagent" && s.parent_id) subsBy.set(s.parent_id, [...(subsBy.get(s.parent_id) ?? []), s]);
  const liveSub = (s: HSession) => s.status === "running" || s.status === "waiting";
  const subsOf = (id: string) => { const xs = subsBy.get(id) ?? []; return { live: xs.filter(liveSub).length, total: xs.length }; };
  const since = Date.now() - RECENT_H * 3600_000;
  const liveS = top.filter((s) => s.status === "running" || s.status === "waiting" || subsOf(s.id).live > 0);
  const recentS = top.filter((s) => !liveS.includes(s) && s.updated_at.getTime() > since && (s.last_idx ?? -1) >= 0).slice(0, 20);
  const subNames = new Map(all.filter((s) => s.kind === "subagent").map((s) => [s.id, s.title || s.id]));
  const needs: Need[] = (await pending(h).catch(() => [])).map((n) => ({ ...n, subName: n.agent_id !== n.chat_id ? subNames.get(n.agent_id) ?? null : null }));
  const shown = [...liveS, ...recentS];
  const ids = shown.flatMap((s) => [s.id, ...(subsBy.get(s.id) ?? []).map((x) => x.id)]);
  const words = new Map<string, { asked: string; said: string }>();
  const use = new Map<string, { fresh: number; cached: number }>();
  if (shown.length) {
    const ph = (xs: unknown[]) => xs.map(() => "?").join(",");
    const rows = (await h.fns.procs.db.select({
      sql: `SELECT a.id,
        (SELECT left(payload::jsonb->>'text', 400) FROM events e WHERE e.agent_id = a.id AND e.type = 'user' ORDER BY idx DESC LIMIT 1) AS asked,
        (SELECT left(payload::jsonb->>'text', 400) FROM events e WHERE e.agent_id = a.id AND e.type = 'assistant' AND coalesce(payload::jsonb->>'text', '') <> '' ORDER BY idx DESC LIMIT 1) AS said
        FROM agents a WHERE a.id IN (${ph(shown)})`, params: shown.map((s) => s.id),
    })) as any[];
    for (const r of rows) words.set(String(r.id), { asked: String(r.asked ?? "").trim(), said: String(r.said ?? "").trim() });
    const u = (await h.fns.procs.db.select({
      sql: `SELECT agent_id,
        COALESCE(SUM(COALESCE((payload::jsonb->'usage'->>'prompt_tokens')::bigint, 0) + COALESCE((payload::jsonb->'usage'->>'completion_tokens')::bigint, 0)), 0) AS t,
        COALESCE(SUM(COALESCE((payload::jsonb->'usage'->>'cache_read_tokens')::bigint, 0)), 0) AS c
        FROM events WHERE type = 'assistant' AND agent_id IN (${ph(ids)}) GROUP BY agent_id`, params: ids,
    }).catch(() => [])) as any[];
    const raw = new Map(u.map((r) => [String(r.agent_id), { t: Number(r.t), c: Number(r.c) }]));
    for (const s of shown) {
      const xs = [s.id, ...(subsBy.get(s.id) ?? []).map((x) => x.id)].map((id) => raw.get(id) ?? { t: 0, c: 0 });
      const tot = xs.reduce((n, x) => n + x.t, 0), cached = xs.reduce((n, x) => n + x.c, 0);
      use.set(s.id, { fresh: Math.max(0, tot - cached), cached });
    }
  }
  const projects = new Map((await loadProjects(h)).map((p) => [p.id, p.name]));
  const toCard = (s: HSession): Card => ({ s, project: s.project_id ? projects.get(s.project_id) ?? null : null, asked: words.get(s.id)?.asked ?? "", said: words.get(s.id)?.said ?? "",
    ...(use.get(s.id) ?? { fresh: 0, cached: 0 }), subs: subsOf(s.id) });
  return { needs, live: liveS.map(toCard), recent: recentS.map(toCard) };
}

/** The page body; it asks for itself again on the person's signals, and every few seconds while anyone works. */
export async function agentsHtml(h: any, me: UserRow, t: T): Promise<Raw> {
  const o = await overview(h, me);
  const busy = o.live.length > 0;
  const live = [...o.live].sort((a, b) => Number(o.needs.some((n) => n.chat_id === b.s.id)) - Number(o.needs.some((n) => n.chat_id === a.s.id)));
  return html`<div class="doc dash-page agents" id="agents" hx-get="/speca/f/agents" hx-trigger="dh-live${busy ? ", every 4s" : ", every 60s"}" hx-swap="outerHTML" data-live-topic="user:${me.id}">
    ${k.pageHead({ title: t("agents.title"), sub: t("agents.sub") })}
    ${k.kpis([{ value: o.live.length, label: t("kpi.atWork") }, { value: o.needs.length, label: t("kpi.waitYou"), ...(o.needs.length ? { tone: "attention" as const } : {}) }, { value: o.recent.length, label: t("kpi.finished") }])}
    <div class="dash-cols"><div class="dash-main">
      ${live.length ? html`<div class="dash-list tk-list">${join(live.map((a) => card(t, a, o.needs)))}</div>` : k.dashEmpty({ icon: "bot", title: t("agents.noneTitle"), text: t("agents.none") })}
      ${o.recent.length ? k.cut({ label: t("agents.recent"), count: o.recent.length, open: !live.length, body: k.rows(o.recent.map((a) => recentRow(t, a)), { divided: true }) }) : ""}
    </div></div>
  </div>`;
}
