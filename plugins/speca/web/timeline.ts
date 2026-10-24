// Speca's timeline (core/runtime/timeline.ts + core/web/views/timeline.ts) as the speca.timeline kind: a project's — or
// a chat's outside a project — work from the start until now, newest first, by day. Each finished turn is one entry:
// what was done (one line a cheap model writes once), what was asked, where (the chat, in a project), how long; its
// marks — the artboards and canvases it changed, files, commits, subagents, decisions — each a way there. Entries are
// taken from the log (web/fold.ts) when the timeline is looked at and when a turn ends; milestones (a chat started, a
// fork made off a chat) come from the chats themselves. The newest page redraws live; older ones come with "Earlier".
import { html, join, raw, type Raw } from "./html.ts";
import { ic } from "./ui/icons.ts";
import * as k from "./ui/kit.ts";
import { dur } from "./fmt.ts";
import { fold, type Turn, type Place } from "./fold.ts";
import { loadEvents, getSession, type HSession } from "./hyper.ts";
import type { T } from "./types.ts";

type H = { fns: any; state?: any };

export type Facts = {
  tools: number;
  places: Place[];
  canvases: Array<{ tabId: string; title: string; v: number }>;
  files: { n: number; added: number; removed: number; names: string[] } | null;
  commits: Array<{ sha: string; message: string }>;
  prs: Array<{ number: number; title: string; url: string }>;
  subagents: Array<{ id: string; name: string }>;
  decisions: number;
  tokens: number;
};
export type Entry = {
  agent_id: string; turn_id: string; project_id: string | null; start_idx: number; end_idx: number; at: Date; ms: number | null;
  asked: string; said: string; facts: Facts; summary: string | null; summary_state: string; chat_title?: string;
};
export type Scope = { kind: "project"; id: string } | { kind: "chat"; id: string };
export const scopeOf = (s: Pick<HSession, "id" | "project_id">): Scope => (s.project_id ? { kind: "project", id: s.project_id } : { kind: "chat", id: s.id });

const sel = async <R = any>(h: H, sql: string, params: unknown[] = []): Promise<R[]> => (await h.fns.procs.db.select({ sql, params })) as R[];
const exec = (h: H, sql: string, params: unknown[] = []) => h.fns.procs.db.run({ sql, params });
const json = (v: unknown) => (typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return {}; } })() : (v ?? {})) as any;

const firstLine = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n);
/** What was asked, without the names of files attached to the message ("[image.png] make it wider" → "make it wider"). */
export const askedText = (s: string) => s.replace(/\[[^\]\n]{1,80}\.[a-z0-9]{2,5}\]\s*/gi, "").trim();

/** What a turn did, as facts — no model. */
export function turnFacts(turn: Turn): { asked: string; said: string; facts: Facts } {
  const user = turn.items.find((i) => i.k === "user");
  const final = [...turn.items].reverse().find((i) => i.k === "assistant" && i.text && !(i as any).streaming);
  const f: Facts = { tools: 0, places: turn.places, canvases: [], files: null, commits: [], prs: [], subagents: [], decisions: 0, tokens: 0 };
  for (const i of turn.items as any[]) {
    if (i.k === "tools") f.tools += i.calls.length;
    else if (i.k === "canvas" && i.d.tabId && !f.canvases.some((c) => c.tabId === String(i.d.tabId))) f.canvases.push({ tabId: String(i.d.tabId), title: String(i.d.title ?? ""), v: Number(i.d.v ?? 1) });
    else if (i.k === "changes" && Array.isArray(i.d.files)) {
      const names = (i.d.files as Array<{ path?: string } | string>).map((x) => (typeof x === "string" ? x : x.path ?? "")).filter(Boolean);
      f.files = { n: names.length + Number(i.d.more ?? 0), added: Number(i.d.added ?? 0), removed: Number(i.d.removed ?? 0), names: names.slice(0, 6) };
    } else if (i.k === "git" && i.d.kind === "commit") f.commits.push({ sha: String(i.d.sha ?? "").slice(0, 8), message: firstLine(String(i.d.message ?? ""), 120) });
    else if (i.k === "git" && i.d.kind === "pr") f.prs.push({ number: Number(i.d.number ?? 0), title: firstLine(String(i.d.title ?? ""), 120), url: String(i.d.url ?? "") });
    else if (i.k === "subagent" && i.d.subId) f.subagents.push({ id: String(i.d.subId), name: String(i.d.name ?? "") });
    else if (i.k === "approval" || i.k === "plan_review" || i.k === "question") f.decisions++;
  }
  f.tokens = turn.tokens ? turn.tokens.in + turn.tokens.cached + turn.tokens.out : 0;
  return { asked: firstLine(askedText(user && user.k === "user" ? (user as any).text : ""), 400), said: firstLine(final && final.k === "assistant" ? (final as any).text : "", 800), facts: f };
}

async function record(h: H, s: HSession, turn: Turn): Promise<void> {
  if (turn.open || !turn.items.some((i) => i.k === "user")) return;
  const { asked, said, facts } = turnFacts(turn);
  const skip = !said && !facts.tools;   // stopped at once: nothing to describe
  await exec(h, `INSERT INTO speca_timeline (agent_id, turn_id, project_id, start_idx, end_idx, at, ms, asked, said, facts, summary_state)
    VALUES (?,?,?,?,?,?,?,?,?,?::jsonb,?)
    ON CONFLICT (agent_id, turn_id) DO UPDATE SET end_idx = EXCLUDED.end_idx, ms = EXCLUDED.ms, said = EXCLUDED.said, facts = EXCLUDED.facts, project_id = EXCLUDED.project_id,
      summary_state = CASE WHEN speca_timeline.end_idx <> EXCLUDED.end_idx AND speca_timeline.summary_state = 'skip' THEN EXCLUDED.summary_state ELSE speca_timeline.summary_state END`,
    [s.id, turn.id, s.project_id, turn.startIdx, turn.lastIdx, turn.started.getTime(), turn.ms, asked, said, JSON.stringify(facts), skip ? "skip" : "none"]);
}

/** The chats of a scope: the project's (not subagents), or the one chat. */
async function scopeChats(h: H, userId: string, sc: Scope): Promise<HSession[]> {
  const ids = sc.kind === "project"
    ? (await sel<{ id: string; scratchpad: any }>(h, `SELECT id, scratchpad FROM agents WHERE project_id = ? AND archived_at IS NULL`, [sc.id])).filter((r) => !json(r.scratchpad).delegation).map((r) => r.id)
    : [sc.id];
  return (await Promise.all(ids.map((id) => getSession(h, userId, id)))).filter((x): x is HSession => !!x);
}

/** Every chat of the scope brought up to date: the turns that ended since its last entry are written (facts only). */
export async function backfill(h: H, userId: string, sc: Scope): Promise<number> {
  let n = 0;
  for (const s of await scopeChats(h, userId, sc)) {
    const last = Number((await sel<{ m: number | null }>(h, `SELECT max(end_idx) AS m FROM speca_timeline WHERE agent_id = ?`, [s.id]))[0]?.m ?? -1);
    if (s.last_idx != null && Number(s.last_idx) <= last) continue;
    for (const turn of fold(await loadEvents(h, s))) {
      if (turn.open || turn.lastIdx <= last) continue;
      await record(h, s, turn);
      n++;
    }
  }
  return n;
}

/** A turn of a chat just ended: its entry, then its "what was done" in the background. */
export async function recordTurnEnd(h: H, userId: string, agentId: string): Promise<void> {
  const s = await getSession(h, userId, agentId);
  if (!s || s.kind === "subagent") return;
  const sc = scopeOf(s);
  await backfill(h, userId, { kind: "chat", id: s.id });
  const todo = await sel<{ agent_id: string; turn_id: string }>(h, `SELECT agent_id, turn_id FROM speca_timeline WHERE agent_id = ? AND summary_state = 'none' ORDER BY at DESC LIMIT 3`, [s.id]);
  if (todo.length) void describe(h, sc, todo, s.id).catch(() => {});
}

/** A page of a scope's timeline, newest first (`before`: older than that moment, ms). */
export async function entries(h: H, sc: Scope, o: { before?: number | null; limit?: number } = {}): Promise<Entry[]> {
  const rows = await sel<any>(h, `SELECT e.*, a.title AS chat_title FROM speca_timeline e JOIN agents a ON a.id = e.agent_id
    WHERE ${sc.kind === "project" ? "e.project_id = ?" : "e.agent_id = ?"} AND a.archived_at IS NULL AND (?::bigint IS NULL OR e.at < ?::bigint)
    ORDER BY e.at DESC LIMIT ${o.limit ?? PAGE}`, [sc.id, o.before ?? null, o.before ?? null]);
  return rows.map((r) => ({ ...r, at: new Date(Number(r.at)), ms: r.ms == null ? null : Number(r.ms), start_idx: Number(r.start_idx), end_idx: Number(r.end_idx), facts: json(r.facts) }));
}

// ── milestones: a chat started, a fork made off a chat — from the chats, not stored ──
export type Milestone =
  | { kind: "chat"; at: Date; sessionId: string; title: string }
  | { kind: "fork"; at: Date; sessionId: string; title: string; parentId: string; parentTitle: string; idx: number };

export async function milestones(h: H, sc: Scope, w: { from: Date | null; to: Date | null }): Promise<Milestone[]> {
  const rows = await sel<any>(h, `SELECT a.id, a.title, a.parent_id, a.fork_offset, a.created_at, a.scratchpad, p.title AS parent_title
    FROM agents a LEFT JOIN agents p ON p.id = a.parent_id
    WHERE a.archived_at IS NULL AND coalesce(a.visibility,'nav') <> 'hidden'
      AND ${sc.kind === "project" ? "a.project_id = ?" : "(a.id = ? OR (a.parent_id = ? AND a.fork_offset IS NOT NULL))"}
      AND (?::bigint IS NULL OR a.created_at > ?::bigint) AND (?::bigint IS NULL OR a.created_at <= ?::bigint)`,
    [sc.id, ...(sc.kind === "chat" ? [sc.id] : []), w.from?.getTime() ?? null, w.from?.getTime() ?? null, w.to?.getTime() ?? null, w.to?.getTime() ?? null]);
  return rows.filter((r) => !json(r.scratchpad).delegation).map((r): Milestone => r.parent_id && r.fork_offset != null
    ? { kind: "fork", at: new Date(Number(r.created_at)), sessionId: r.id, title: r.title ?? "", parentId: r.parent_id, parentTitle: r.parent_title ?? "", idx: Number(r.fork_offset) }
    : { kind: "chat", at: new Date(Number(r.created_at)), sessionId: r.id, title: r.title ?? "" })
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}

// ── "what was done": one sentence per turn from a cheap model, once; for the entries the person looks at ──
const DESCRIBE = `You write one line of a project's timeline: what this turn of work achieved — its result, concretely (what
was made, changed, decided or found), not its steps and not the request repeated. One sentence, at most 16 words, no
quotes, no preamble, in {lang}. Names of canvases, artboards and files as they are.`;
/** The cheap models tried in turn (the first one that answers is kept for the next time). */
const CHEAP = ["anthropic-oauth/personal:claude-haiku-4-5", "claude-code:claude-haiku-4-5", "codex:gpt-6-luna"];

async function cheapCall(h: H, system: string, user: string): Promise<string> {
  const st = ((h.state ??= {}) as any).specaTimeline ??= { busy: new Set<string>(), model: null as string | null };
  const order = st.model ? [st.model, ...CHEAP.filter((m) => m !== st.model)] : CHEAP;
  let last: unknown = null;
  for (const model of order) {
    try {
      const r = await h.fns.llm.call({ model, system, user, max_tokens: 120, timeoutMs: 30_000, noFallback: true });
      const text = String(r?.text ?? "").trim();
      if (text) { st.model = model; return text; }
    } catch (e) { last = e; }
  }
  throw last ?? new Error("no cheap model answered");
}

export function topicOf(agentId: string) { return `speca:timeline:${agentId}`; }

export async function describe(h: H, _sc: Scope, keys: Array<{ agent_id: string; turn_id: string }>, notify: string, locale = "ru"): Promise<void> {
  const st = ((h.state ??= {}) as any).specaTimeline ??= { busy: new Set<string>(), model: null };
  const todo = keys.filter((x) => !st.busy.has(`${x.agent_id}/${x.turn_id}`));
  if (!todo.length) return;
  for (const x of todo) st.busy.add(`${x.agent_id}/${x.turn_id}`);
  const lang = locale === "en" ? "English" : "Russian";
  const queue = [...todo];
  const work = async () => {
    for (let x = queue.shift(); x; x = queue.shift()) {
      try {
        const e = (await sel<any>(h, `SELECT * FROM speca_timeline WHERE agent_id = ? AND turn_id = ? AND summary_state = 'none'`, [x.agent_id, x.turn_id]))[0];
        if (!e) continue;
        await exec(h, `UPDATE speca_timeline SET summary_state = 'asked' WHERE agent_id = ? AND turn_id = ?`, [x.agent_id, x.turn_id]);
        const f: Facts = json(e.facts);
        const digest = [`Asked: ${e.asked}`, e.said ? `Answered: ${e.said}` : "",
          f.places?.length ? `Changed artboards: ${f.places.map((p) => p.title).join(", ")}` : "",
          f.canvases?.length ? `Canvases: ${f.canvases.map((c) => c.title).join(", ")}` : "",
          f.files ? `Files changed: ${f.files.n} (${f.files.names.join(", ")})` : "",
          f.commits?.length ? `Commits: ${f.commits.map((c) => c.message).join("; ")}` : "",
          f.subagents?.length ? `Subagents: ${f.subagents.map((s) => s.name).join(", ")}` : "",
          `Tool calls: ${f.tools ?? 0}`].filter(Boolean).join("\n");
        const text = (await cheapCall(h, DESCRIBE.replace("{lang}", lang), digest.slice(0, 4000))).split("\n")[0]!.replace(/^["«]|["»]$/g, "").slice(0, 200);
        await exec(h, `UPDATE speca_timeline SET summary = ?, summary_state = ? WHERE agent_id = ? AND turn_id = ?`, [text || null, text ? "done" : "skip", x.agent_id, x.turn_id]);
      } catch {
        await exec(h, `UPDATE speca_timeline SET summary_state = 'none' WHERE agent_id = ? AND turn_id = ? AND summary_state = 'asked'`, [x.agent_id, x.turn_id]).catch(() => {});
      } finally { st.busy.delete(`${x.agent_id}/${x.turn_id}`); }
    }
  };
  await Promise.all([work(), work(), work()]);
  h.fns.procs.events.emit({ topic: topicOf(notify), event: { type: "speca.timeline" } });
}

// ── the view ──
const PAGE = 40;
const kn = (t: T, n: number) => new Intl.NumberFormat(t.locale, { notation: "compact", maximumFractionDigits: 1 }).format(n);
const dayKey = (d: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const hm = (d: Date, tz: string, locale: string) => new Intl.DateTimeFormat(locale, { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(d);

function dayLabel(t: T, d: Date, tz: string): string {
  const k0 = dayKey(d, tz), today = dayKey(new Date(), tz), yesterday = dayKey(new Date(Date.now() - 86_400_000), tz);
  if (k0 === today) return t("tl.today");
  if (k0 === yesterday) return t("tl.yesterday");
  return new Intl.DateTimeFormat(t.locale, { timeZone: tz, day: "numeric", month: "long", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) }).format(d);
}

/** One turn: what was done, then where and how long, then its marks; the entry leads to its message. */
function entryHtml(t: T, e0: Entry, o: { here: string; project: boolean; tz: string }): Raw {
  const e = { ...e0, asked: askedText(e0.asked) };
  const f = e.facts;
  const go = `/speca/s/${e.agent_id}?at=${e.start_idx}`;
  const pending = !e.summary && (e.summary_state === "none" || e.summary_state === "asked");
  const meta = [o.project ? e.chat_title || t("chat.newChat") : "", e.summary ? `${t("tl.asked")}: ${e.asked}` : "", e.ms ? dur(e.ms, t.locale) : "", f.tokens ? t("sub.tokens", { n: kn(t, f.tokens) }) : ""].filter(Boolean).join(" · ");
  // a place on a canvas: in this chat — brought to the front here; in another chat of the project — that chat with it open
  const place = (tabId: string, focus: string | undefined, title: string, icon: string) => e.agent_id === o.here
    ? html`<button type="button" class="place" hx-post="/speca/canvas/${tabId}/focus" hx-vals='${JSON.stringify({ focus: focus ?? "" })}' hx-swap="none" title="${t("chat.placeShow")}">${ic(icon, "ic-xs")}${title}</button>`
    : html`<a class="place" href="/speca/s/${e.agent_id}?tab=${tabId}${focus ? `&focus=${encodeURIComponent(focus)}` : ""}" title="${t("chat.placeShow")}">${ic(icon, "ic-xs")}${title}</a>`;
  const marks: Raw[] = [
    ...(f.places ?? []).map((p) => place(p.tabId, p.focus, p.title, "penTool")),
    ...(f.canvases ?? []).filter((c) => !(f.places ?? []).some((p) => p.tabId === c.tabId)).map((c) => place(c.tabId, undefined, c.title, "appWindow")),
    ...(f.files ? [e.agent_id === o.here
      ? html`<button type="button" class="place" hx-post="/speca/s/${e.agent_id}/changes/open" hx-vals='${JSON.stringify({ turn: e.turn_id })}' hx-swap="none">${ic("fileDiff", "ic-xs")}${t("tl.files", { n: f.files.n })}${f.files.added || f.files.removed ? html`<small>+${f.files.added} −${f.files.removed}</small>` : ""}</button>`
      : html`<a class="place" href="${go}">${ic("fileDiff", "ic-xs")}${t("tl.files", { n: f.files.n })}${f.files.added || f.files.removed ? html`<small>+${f.files.added} −${f.files.removed}</small>` : ""}</a>`] : []),
    ...(f.commits ?? []).map((c) => html`<span class="place quiet" title="${c.message}">${ic("check", "ic-xs")}${c.sha} ${c.message}</span>`),
    ...(f.prs ?? []).map((p) => html`<a class="place" href="${p.url}" target="_blank" rel="noopener">${ic("pr", "ic-xs")}#${p.number} ${p.title}</a>`),
    ...(f.subagents?.length ? [html`<button type="button" class="place" hx-post="/speca/s/${e.agent_id}/subs/canvas" hx-swap="none">${ic("bot", "ic-xs")}${t("agents.subsN", { n: f.subagents.length })}</button>`] : []),
    ...(f.decisions ? [html`<span class="place quiet">${ic("shield", "ic-xs")}${t("tl.decisions", { n: f.decisions })}</span>`] : []),
  ];
  return html`<li class="tl-i"><time class="tl-t" datetime="${e.at.toISOString()}">${hm(e.at, o.tz, t.locale)}</time><span class="tl-dot" aria-hidden="true"></span>
    <div class="tl-b"><a class="tl-s${pending ? " pending" : ""}" href="${go}" title="${t("tl.toMessage")}">${e.summary || e.asked || t("chat.newChat")}</a>
      ${meta ? html`<p class="tl-m">${meta}</p>` : ""}${marks.length ? html`<div class="tl-marks">${join(marks)}</div>` : ""}</div></li>`;
}

function mileHtml(t: T, m: Milestone, o: { tz: string }): Raw {
  const name = (x: string) => x || t("chat.newChat");
  const body = m.kind === "chat" ? html`${t("tl.chatStarted")} <a href="/speca/s/${m.sessionId}">${name(m.title)}</a>`
    : html`${t("tl.forked")} <a href="/speca/s/${m.sessionId}">${name(m.title)}</a> ${t("tl.forkOf")} <a href="/speca/s/${m.parentId}?at=${m.idx}">${name(m.parentTitle)}</a>`;
  return html`<li class="tl-i tl-mile" data-kind="${m.kind}"><time class="tl-t" datetime="${m.at.toISOString()}">${hm(m.at, o.tz, t.locale)}</time><span class="tl-mk" aria-hidden="true">${ic(m.kind === "chat" ? "msg" : "fork", "ic-xs")}</span><p class="tl-mt">${body}</p></li>`;
}

function listHtml(t: T, list: Entry[], miles: Milestone[], o: { here: string; project: boolean; tz: string; after?: string }): Raw {
  let day = o.after ?? "";
  const out: Raw[] = [];
  const all = [...list.map((e) => ({ at: e.at, e })), ...miles.map((m) => ({ at: m.at, m }))].sort((a, b) => b.at.getTime() - a.at.getTime());
  for (const x of all) {
    const k0 = dayKey(x.at, o.tz);
    if (k0 !== day) { out.push(html`<li class="tl-day"><span>${dayLabel(t, x.at, o.tz)}</span></li>`); day = k0; }
    out.push("e" in x ? entryHtml(t, x.e!, o) : mileHtml(t, (x as any).m, o));
  }
  return join(out);
}

const pageMiles = (h: H, sc: Scope, list: Entry[], before: Date | null) => milestones(h, sc, { from: list.length === PAGE ? list.at(-1)!.at : null, to: before });

const moreBtn = (t: T, sid: string, list: Entry[], tz: string): Raw => list.length < PAGE ? html`<div id="tl-more"></div>`
  : html`<div id="tl-more" class="tl-more">${k.button({ label: t("tl.earlier"), variant: "outline", size: "sm", attrs: html`hx-get="/speca/s/${sid}/timeline/more?before=${list.at(-1)!.at.getTime()}&day=${dayKey(list.at(-1)!.at, tz)}" hx-target="#tl-older" hx-swap="beforeend"` })}</div>`;

async function scopeName(h: H, s: HSession, sc: Scope): Promise<string> {
  return sc.kind === "project" ? String((await sel<{ title: string }>(h, `SELECT title FROM projects WHERE id = ?`, [sc.id]))[0]?.title ?? "") : s.title;
}

function describeShown(h: H, sc: Scope, list: Entry[], here: string, locale: string) {
  const todo = list.filter((e) => e.summary_state === "none").map((e) => ({ agent_id: e.agent_id, turn_id: e.turn_id }));
  if (todo.length) void describe(h, sc, todo, here, locale).catch(() => {});
}

/** The newest page: redrawn when the chat changes or an entry is described. */
export async function timelineRecent(h: H, userId: string, t: T, s: HSession, tz: string): Promise<Raw> {
  const sc = scopeOf(s);
  await backfill(h, userId, sc);
  const list = await entries(h, sc, { limit: PAGE });
  describeShown(h, sc, list, s.id, t.locale);
  const miles = await pageMiles(h, sc, list, null);
  return html`<ol class="tl" id="tl-recent" hx-get="/speca/s/${s.id}/timeline/recent" hx-trigger="dh-live" hx-swap="outerHTML" data-live-topic="timeline:${s.id}">${listHtml(t, list, miles, { here: s.id, project: sc.kind === "project", tz })}</ol>`;
}

/** The whole canvas: what it is the timeline of, the newest page, the older ones as they are asked for. */
export async function timelineHtml(h: H, userId: string, t: T, s: HSession, tz: string): Promise<Raw> {
  const sc = scopeOf(s);
  await backfill(h, userId, sc);
  const name = await scopeName(h, s, sc);
  const list = await entries(h, sc, { limit: PAGE });
  const first = (await sel<{ at: string | null; n: string }>(h, `SELECT min(at) AS at, count(*) AS n FROM speca_timeline WHERE ${sc.kind === "project" ? "project_id" : "agent_id"} = ?`, [sc.id]))[0];
  const n = Number(first?.n ?? 0);
  const sub = [sc.kind === "project" ? t("tl.ofProject", { name }) : t("tl.ofChat", { name: name || t("chat.newChat") }),
    n ? t("tl.turns", { n }) : "", first?.at ? t("tl.since", { date: new Intl.DateTimeFormat(t.locale, { timeZone: tz, day: "numeric", month: "long" }).format(new Date(Number(first.at))) }) : ""].filter(Boolean).join(" · ");
  const wrap = (body: Raw) => html`<div class="doc dash-page tl-page" id="tl-page">${body}</div>`;
  if (!list.length && !(await milestones(h, sc, { from: null, to: null })).length) return wrap(html`${k.pageHead({ title: t("tl.title"), sub })}${k.dashEmpty({ icon: "clock", title: t("tl.noneTitle"), text: t("tl.none") })}`);
  return wrap(html`${k.pageHead({ title: t("tl.title"), sub })}${await timelineRecent(h, userId, t, s, tz)}<ol class="tl" id="tl-older"></ol>${moreBtn(t, s.id, list, tz)}`);
}

/** An older page (appended under the ones shown), and the button for the one before it. */
export async function timelineMore(h: H, t: T, s: HSession, tz: string, before: number, afterDay: string): Promise<Raw> {
  const sc = scopeOf(s);
  const list = await entries(h, sc, { before, limit: PAGE });
  describeShown(h, sc, list, s.id, t.locale);
  const miles = await pageMiles(h, sc, list, new Date(before));
  return html`${listHtml(t, list, miles, { here: s.id, project: sc.kind === "project", tz, after: afterDay })}${raw(String(moreBtn(t, s.id, list, tz)).replace('<div id="tl-more"', '<div id="tl-more" hx-swap-oob="outerHTML"'))}`;
}
