// A chat's subagents on its canvas (speca.subagents), as in Speca (core/web/views/subboard.ts): figures (working,
// done, tokens), then a card each (k.ticket) — its name, state and time, what it is for, how far by its own plan, what
// came of it, its model and tokens; its run opens over the chat — redrawn while any works. Hyper's subagents are the
// chat's delegated children (agent.delegate): rows of `agents` with this parent and a `delegation` in the scratchpad.
import { html, join, type Raw } from "./html.ts";
import * as k from "./ui/kit.ts";
import { prettyModel, type SubView, type T } from "./types.ts";

type Plan = { content: string; status: "completed" | "in_progress" | "pending" };
export type Sub = {
  id: string; name: string; goal: string; model: string; status: "running" | "idle" | "error"; steps: number;
  plan: Plan[]; ms: number; tokensIn: number; tokensCached: number; tokensOut: number;
  result: { status: "done" | "error" | "stopped"; text: string } | null;
};

const json = (v: unknown) => (typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return {}; } })() : (v ?? {})) as any;

/** The chat's subagents, oldest first. */
export async function subsOf(ctx: { fns: any }, parentId: string): Promise<Sub[]> {
  const rows = (await ctx.fns.procs.db.select({ sql: "SELECT id, title, model, run_state, scratchpad, last_error, created_at, updated_at FROM agents WHERE parent_id = ? ORDER BY created_at ASC", params: [parentId] })) as any[];
  const subs = rows.map((r) => ({ r, sp: json(r.scratchpad) })).filter((x) => x.sp.delegation);
  if (!subs.length) return [];
  const use = (await ctx.fns.procs.db.select({
    sql: `SELECT agent_id,
      COALESCE(SUM(COALESCE((payload::jsonb->'usage'->>'prompt_tokens')::bigint, (payload::jsonb->'usage'->>'input')::bigint, 0)), 0) AS i,
      COALESCE(SUM(COALESCE((payload::jsonb->'usage'->>'cache_read_tokens')::bigint, (payload::jsonb->'usage'->>'cacheRead')::bigint, 0)), 0) AS c,
      COALESCE(SUM(COALESCE((payload::jsonb->'usage'->>'completion_tokens')::bigint, (payload::jsonb->'usage'->>'output')::bigint, 0)), 0) AS o
      FROM events WHERE type = 'assistant' AND agent_id IN (${subs.map(() => "?").join(",")}) GROUP BY agent_id`,
    params: subs.map((x) => x.r.id),
  })) as any[];
  const steps = (await ctx.fns.procs.db.select({ sql: `SELECT agent_id, COUNT(*) AS n FROM events WHERE type = 'tool_call' AND agent_id IN (${subs.map(() => "?").join(",")}) GROUP BY agent_id`, params: subs.map((x) => x.r.id) })) as any[];
  const by = new Map(use.map((u) => [String(u.agent_id), u]));
  const nBy = new Map(steps.map((u) => [String(u.agent_id), Number(u.n)]));
  return subs.map(({ r, sp }) => {
    const d = sp.delegation, tasks: any[] = Array.isArray(sp.plan?.tasks) ? sp.plan.tasks : [];
    const st = String(d.status ?? "working");
    const result: Sub["result"] = st === "ready" ? { status: "done", text: String(d.summary ?? d.result?.summary ?? "") }
      : st === "failed" ? { status: "error", text: String(d.summary ?? r.last_error ?? "") }
      : st === "blocked" || st === "stopped" ? { status: "stopped", text: String(d.summary ?? "") } : null;
    const start = Number(d.createdAt ?? r.created_at), end = result ? Number(d.result?.finishedAt ?? r.updated_at) : Date.now();
    const u = by.get(String(r.id));
    return {
      id: String(r.id), name: String(r.title || d.title || r.id), goal: String(d.title ?? r.title ?? ""),
      model: prettyModel(String(r.model ?? "")), steps: nBy.get(String(r.id)) ?? 0,
      status: r.run_state === "running" ? "running" : r.last_error && !result ? "error" : "idle",
      plan: tasks.map((t) => ({ content: String(t.title ?? t.id), status: t.status === "done" ? "completed" : t.status === "active" ? "in_progress" : "pending" })),
      ms: Math.max(0, end - start), tokensIn: Number(u?.i ?? 0), tokensCached: Number(u?.c ?? 0), tokensOut: Number(u?.o ?? 0), result,
    } satisfies Sub;
  });
}

export const clock = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
export const kn = (t: T, n: number) => new Intl.NumberFormat(t.locale, { notation: "compact", maximumFractionDigits: 1 }).format(n);
export const firstLine = (s: string) => s.split("\n").map((x) => x.trim().replace(/^(#+|>|[-*+]|\d+\.)\s+/, "").replace(/\*\*|__|`/g, "")).find(Boolean) ?? "";

/** A plan on a card: the percentage and "step n of m" (the one in work), "n of m" once over. */
function tkPlan(t: T, plan: Plan[], over: "done" | "other" | null): { pct: number; label: string } | null {
  if (!plan.length) return null;
  const done = plan.filter((p) => p.status === "completed").length;
  if (over === "done") return { pct: 100, label: t("subb.of", { done: plan.length, total: plan.length }) };
  return { pct: Math.round((done / plan.length) * 100), label: over ? t("subb.of", { done, total: plan.length }) : t("tk.step", { n: Math.min(done + 1, plan.length), total: plan.length }) };
}
export function tkProgress(t: T, plan: Plan[], o: { working: boolean; over: "done" | "other" | null; idle?: string }) {
  const p = tkPlan(t, plan, o.over);
  const at = plan.find((x) => x.status === "in_progress") ?? plan.find((x) => x.status === "pending");
  if (p) return { text: o.working ? at?.content ?? t("chat.thinking") : at?.content ?? t("tk.allDone"), label: p.label, pct: p.pct };
  return o.working ? { text: o.idle ?? t("chat.thinking"), pct: null } : null;
}
export const tkUsage = (t: T, fresh: number, cached: number) => (fresh + cached > 0 ? [kn(t, fresh), cached > 0 ? `${t("tk.cache")} ${kn(t, cached)}` : ""].filter(Boolean).join(" · ") : undefined);
export const tkBtn = (icon: string, tip: string, o: { href?: string; attrs?: Raw; tk?: "go" | "stop" } = {}) =>
  k.button({ icon, variant: "ghost", size: "icon-sm", tooltip: tip, side: "top", href: o.href, attrs: html`${o.tk ? html`data-tk="${o.tk}" ` : ""}${o.attrs ?? html``}` });

function card(t: T, v: Sub): Raw {
  const st = v.result ? v.result.status : v.status === "running" ? "running" : v.status === "error" ? "error" : v.plan.some((p) => p.status !== "completed") ? "queued" : "running";
  const tone: k.TicketTone = st === "running" || st === "queued" ? "run" : st === "done" ? "done" : st === "error" ? "bad" : "idle";
  const state = t(st === "running" ? "tk.st.run" : st === "queued" ? "tk.st.queued" : st === "done" ? "tk.st.done" : st === "error" ? "tk.st.bad" : "tk.st.stopped");
  const over = v.result ? (v.result.status === "done" ? "done" : "other") : null;
  const note = v.result ? { label: t(v.result.status === "error" ? "tk.slot.failed" : "tk.slot.result"), text: firstLine(v.result.text) || t(v.result.status === "done" ? "sub.st.done" : v.result.status === "error" ? "subb.failed" : "subb.stopped"), bad: v.result.status === "error" } : null;
  return k.ticket({
    tone, where: { icon: "bot", text: v.name }, state, time: v.result ? t("tk.t.took", { t: clock(v.ms) }) : t("tk.t.run", { t: clock(v.ms) }),
    title: v.goal || v.name, progress: tkProgress(t, v.plan, { working: !v.result, over, idle: st === "queued" ? t("sub.st.queued") : undefined }),
    note, model: v.model, usage: tkUsage(t, Math.max(0, v.tokensIn - v.tokensCached) + v.tokensOut, v.tokensCached),
    tools: html`${tkBtn("arrowUR", t("subb.openRun"), { href: `/speca/s/${v.id}`, attrs: html`data-sub="${v.id}"` })}${!v.result ? tkBtn("square", t("tk.stop"), { tk: "stop", attrs: html`hx-post="/speca/s/${v.id}/stop" hx-swap="none"` }) : ""}`,
    attrs: html`id="sbc-${v.id}" data-st="${st}"`,
  });
}

/** The board: a head with how many work and are done, then the cards; it asks for itself again while any works. */
export async function subBoard(ctx: { fns: any }, t: T, parentId: string): Promise<Raw> {
  const subs = await subsOf(ctx, parentId);
  const live = subs.filter((v) => !v.result).length;
  const wrap = (body: Raw) => html`<div class="doc dash-page subb-board" hx-get="/speca/s/${parentId}/subs/board" hx-trigger="dh-live${live ? ", every 3s" : ""}" hx-swap="outerHTML" data-live-topic="sub:${parentId}">${body}</div>`;
  if (!subs.length) return wrap(k.dashEmpty({ icon: "bot", title: t("subb.noneTitle"), text: t("subb.none") }));
  const done = subs.filter((v) => v.result?.status === "done").length;
  const tokens = subs.reduce((n, v) => n + v.tokensIn + v.tokensOut, 0);
  const order = (v: Sub) => (!v.result ? 1 : 2);
  const figures = k.kpis([{ value: live, label: t("kpi.working") }, { value: done, label: t("kpi.done") }, { value: kn(t, tokens), label: t("kpi.tokens") }]);
  return wrap(html`${k.pageHead({ title: t("subb.title"), sub: t("subb.sub") })}${figures}<div class="dash-list tk-list">${join([...subs].sort((a, b) => order(a) - order(b)).map((v) => card(t, v)))}</div>`);
}

/** One subagent as its card in the parent's chat (views/chat.ts subagentCard) reads it. */
export async function subView(ctx: { fns: any }, id: string): Promise<{ parentId: string; v: SubView } | null> {
  const row = ((await ctx.fns.procs.db.select({ sql: "SELECT parent_id FROM agents WHERE id = ?", params: [id] })) as any[])[0];
  if (!row?.parent_id) return null;
  const s = (await subsOf(ctx, String(row.parent_id))).find((x) => x.id === id);
  if (!s) return null;
  return { parentId: String(row.parent_id), v: {
    id: s.id, name: s.name, task: s.goal, modelLabel: s.model, status: s.status, mode: "all", steps: s.steps,
    tokensIn: s.tokensIn, tokensOut: s.tokensOut, cost: 0, ms: s.ms, approvals: 0, result: s.result,
  } };
}
