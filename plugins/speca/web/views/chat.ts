// The agent window: header, the folded log, the queue dock and the composer (T3 Code look, prototype classes).
import type { GitState, App, SubView, UsageRow, TriggerRow, T, SessionRow, EventRow, InboxRow, UserRow, ModelOption, Script, RunRow } from "../types.ts";
import { html, raw, join, esc, type Raw } from "../html.ts";
import { ic } from "../ui/icons.ts";
import * as k from "../ui/kit.ts";
import { md } from "../md.ts";
import { fold, collapses, type Turn, type Item, type Call } from "../fold.ts";
import { EFFORTS, initials, PERSONAL_KINDS, prettyModel } from "../types.ts";
import { clock, dur, durMin, rel } from "../fmt.ts";

export type ChatCtx = { app: App; t: T; me: UserRow; s: SessionRow; owner: UserRow; readonly: boolean; participant?: boolean; preview?: string | null; models: ModelOption[]; tzone: string; csrf: string;
  /** A code project's chat: its folder, repository, scripts and the dev run everyone in the project sees. */
  code?: CodeCtx | null;
  /** The chat this one was forked from, and the forks made from this one (where in the log each went off). */
  forkOf?: { id: string; title: string } | null; forks?: Array<{ id: string; title: string; idx: number }> };
export type CodeCtx = { projectId: string; dir: string; repo: string | null; runner: string | null; computer?: { name: string; online: boolean } | null; scripts: Script[]; run: (RunRow & { running: boolean }) | null; canRun: boolean; branch: string | null };
/** Decisions (approvals, questions, plans, settings) are the owner's, also in a shared chat. */
const decides = (cx: ChatCtx) => !cx.readonly && cx.me.id === cx.s.owner_id;

// ── work log categories ───────────────────────────────────────────────
export const CAT_ICON: Record<string, string> = { read: "fileText", search: "search", write: "pencil", web: "globe", connector: "plug", agent: "users", subagent: "bot", canvas: "appWindow", plan: "listChecks" };

export function categoryOf(app: App, name: string): { cat: string; plugin: string | null; title: string } {
  const internal = name.replace(/^mcp__(?:speca|deskhand)__/, "");
  for (const [n, { pluginId, def }] of app.registry.tools) {
    if (n.replace(/\./g, "_") === internal) {
      const title = typeof def.title === "string" ? def.title : def.title?.en ?? n;
      return { cat: def.category ?? (pluginId === "core" ? "read" : "connector"), plugin: pluginId === "core" ? null : pluginId, title };
    }
  }
  if (internal.startsWith("mcp__claude_ai_")) return { cat: "connector", plugin: internal.split("__")[1]!.replace("claude_ai_", ""), title: internal.split("__").slice(2).join(" ") };
  if (/^Web(Search|Fetch)$/.test(internal)) return { cat: "web", plugin: null, title: internal };
  const plugin = internal.includes("_") ? internal.split("_")[0]! : null;
  return { cat: "connector", plugin, title: internal };
}

export function localTitle(app: App, t: T, name: string): string {
  const internal = name.replace(/^mcp__(?:speca|deskhand)__/, "");
  for (const [n, { def }] of app.registry.tools) {
    if (n.replace(/\./g, "_") === internal && def.title) return typeof def.title === "string" ? def.title : (def.title[t.locale] ?? def.title.en);
  }
  return categoryOf(app, name).title.replace(/_/g, " ");
}

export function detailOf(c: Pick<Call, "args">): string {
  const a = c.args ?? {};
  for (const k of ["title", "description", "query", "q", "path", "subject", "person", "question", "kind", "url"]) {
    const v = a[k];
    if (typeof v === "string" && v) return v.slice(0, 160);
  }
  return "";
}

function groupTitle(cx: ChatCtx, calls: Call[], running: boolean): string {
  const { t, app } = cx;
  if (running) {
    const cur = calls.find((c) => c.status !== "done") ?? calls[calls.length - 1]!;
    const d = detailOf(cur);
    return `${localTitle(app, t, cur.name)}${d ? ` · ${d}` : ""}`;
  }
  const counts = new Map<string, number>();
  for (const c of calls) {
    const { cat, plugin } = categoryOf(app, c.name);
    if (c.name === "plan_write") continue;
    const key = cat === "connector" && plugin ? `p:${plugin}` : `c:${cat}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const [k, n] of counts) {
    if (k.startsWith("p:")) {
      const pid = k.slice(2);
      const pm = app.registry.plugins.get(pid)?.manifest.name;
      const label = pm ? (typeof pm === "string" ? pm : pm[t.locale] ?? pm.en) : pid.replace(/_/g, " ");
      parts.push(`${label} ${n}`);
    } else parts.push(t(`work.${k.slice(2)}` as never, { n }));
  }
  return parts.join(" · ") || t("work.plan" as never, { n: 1 });
}

/** ok · skipped (not done by a decision: rejected, not allowed, plan mode) · unknown (no answer — may have happened) · error */
export function callState(c: Call): "ok" | "skipped" | "unknown" | "error" {
  if (!c.isError) return "ok";
  if (c.meta?.unknown) return "unknown";
  if (c.reason && ["rejected", "cancelled", "expired", "unavailable", "denied", "mode"].includes(c.reason)) return "skipped";
  return "error";
}

// a call's row: what it did; its arguments and result come when it is opened (GET /s/:id/call — a long chat's log once
// carried 1.5 MB of them, folded, to every visit)
const turnRange = (cx: ChatCtx, turn: Turn) => `/speca/s/${cx.s.id}/{what}?from=${turn.startIdx}&to=${turn.lastIdx}`;
function callRow(cx: ChatCtx, c: Call, turn: Turn): Raw {
  const { cat } = categoryOf(cx.app, c.name);
  const state = callState(c);
  const icon = state === "error" ? "alert" : state === "unknown" ? "clock" : state === "skipped" ? "x" : CAT_ICON[cat] ?? "zap";
  const d = detailOf(c);
  return html`<li class="${state === "ok" ? "" : state === "error" ? "err" : state}" data-call="${c.id}" title="${state === "unknown" ? cx.t("work.unknown") : state === "skipped" ? cx.t("work.skipped") : ""}">${ic(icon, "ic-xs")}<details class="call" hx-get="${turnRange(cx, turn).replace("{what}", "call")}&id=${encodeURIComponent(c.id)}" hx-trigger="toggle once" hx-target="find .call-b" hx-swap="innerHTML"><summary><span class="mono">${localTitle(cx.app, cx.t, c.name)}${d ? ` · ${d}` : ""}</span>${c.status !== "done" ? html`<i class="spin"></i>` : ""}</summary><div class="call-b"><span class="skel skel-line"></span></div></details></li>`;
}

/** What a call was given and what it returned (with a way to connect a plugin it needed). */
export function callBody(cx: ChatCtx, c: Call): Raw {
  const resultPreview = c.text ? c.text.slice(0, 600) : "";
  return html`${Object.keys(c.args ?? {}).length ? html`<pre class="call-args">${JSON.stringify(c.args, null, 2).slice(0, 2000)}</pre>` : ""}
    ${resultPreview ? html`<pre class="call-out">${resultPreview}${c.text.length > 600 ? "…" : ""}</pre>` : ""}
    ${c.meta?.notConnected ? html`<a class="btn" data-size="sm" data-variant="outline" href="/speca/plugins?sel=${c.meta.notConnected}" data-dialog>${ic("plug", "ic-sm")}${cx.t("plugins.connect")}</a>` : ""}`;
}

/** A group's calls; a folded group gets them when it is opened (GET /s/:id/tools) — only a running one comes drawn. */
export function toolsList(cx: ChatCtx, g: { id: string; calls: Call[] }, turn: Turn): Raw {
  return html`<ul class="tools-list">${join(g.calls.map((c) => callRow(cx, c, turn)))}</ul>`;
}

function toolsGroup(cx: ChatCtx, g: { id: string; calls: Call[] }, open: boolean, turn: Turn): Raw {
  const running = g.calls.some((c) => c.status !== "done");
  const failed = g.calls.some((c) => callState(c) === "error");
  return html`<div class="e static tools" id="${g.id}" data-open="${running || open ? "true" : "false"}">
    <button class="tools-h" data-act="toggle-tools" aria-expanded="${running || open}">${ic("chevDown", "ic-sm chev")}${running ? html`<i class="spin" style="color:var(--signal)"></i>` : failed ? ic("alert", "ic-sm") : raw(`<svg class="ic ic-sm ok-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`)}<span class="${running ? "shimmer" : ""}">${groupTitle(cx, g.calls, running)}</span></button>
    <div class="collapsible"><div>${running || open ? toolsList(cx, g, turn)
      : html`<ul class="tools-list" hx-get="${turnRange(cx, turn).replace("{what}", "tools")}&group=${encodeURIComponent(g.id)}" hx-trigger="dh-open once" hx-swap="outerHTML"><li><span class="skel skel-line"></span></li></ul>`}</div></div>
  </div>`;
}

/** "[image.png]" in a message → an inline chip of that attachment (the text says which picture it means). */
// a design element the person pointed at: [Board › tag «text»](File.html#tid:path)
const ELEMENT_REF = /\[([^\]\n]{1,160})\]\(([A-Za-z0-9_][A-Za-z0-9_.-]{0,60}\.html(?:#\d+:[\d/]*)?)\)/g;

function withMentions(text: string, atts: Array<{ id: string; name: string; mime: string }>): Raw {
  const byName = new Map(atts.map((a) => [a.name, a]));
  const named = atts.length ? `\\[(${atts.map((a) => a.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\]` : null;
  const re = new RegExp([ELEMENT_REF.source, named].filter(Boolean).join("|"), "g");
  const out: Raw[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    out.push(html`${text.slice(last, m.index)}`);
    if (m[1] !== undefined) out.push(html`<span class="u-ref" title="${m[1]} · ${m[2]}">${ic("penTool", "ic-xs")}<span class="u-ref-t">${m[1]}</span></span>`);
    else { const a = byName.get(m[3]!)!; out.push(html`<a class="u-ref" href="/speca/files/${a.id}" target="_blank" rel="noopener">${a.mime.startsWith("image/") ? html`<img src="/speca/files/${a.id}" alt="">` : ic("paperclip", "ic-xs")}<span class="u-ref-t">${a.name}</span></a>`); }
    last = m.index! + m[0].length;
  }
  out.push(html`${text.slice(last)}`);
  return join(out);
}

function approvalCard(cx: ChatCtx, it: Extract<Item, { k: "approval" }>): Raw {
  const { t } = cx;
  const d = it.d;
  const risk = d.kind === "local" ? t("appr.local") : d.effect === "irreversible" ? t("appr.irreversible") : d.shared ? t("appr.personal") : t("appr.external");
  if (it.status) {
    const ok = it.status === "approved";
    const key = ok ? "appr.approvedAt" : it.status === "rejected" ? "appr.rejectedAt" : it.status === "expired" ? "appr.expired" : "appr.cancelled";
    // a decided approval is one quiet line; the full text is in the tooltip
    return k.banner({ cls: "e static", id: `appr-${it.id}`, title: d.summary, oneLine: true, icon: ok ? "check" : "x",
      text: html`${t(key as never, { time: it.decidedAt ? clock(it.decidedAt, cx.tzone) : "" })}${d.plugin ? html` · <b>${d.plugin}</b>` : ""} · ${d.summary}` });
  }
  if (!decides(cx)) return k.banner({ cls: "e static", id: `appr-${it.id}`, title: d.summary, oneLine: true, icon: "clock", text: `${t("appr.waitingOwner")}: ${d.summary}` });
  // the kind of action as a tag (irreversible in the destructive tone), what exactly, then decline · do it;
  // Enter / Esc work while the card has focus ([data-approval] [data-key])
  const irreversible = d.kind !== "local" && d.effect === "irreversible";
  return html`<div class="e static appr" id="appr-${it.id}" tabindex="0" data-approval="${it.id}">
    <div class="appr-k">${k.pill(risk, irreversible ? "bad" : d.kind === "local" ? "muted" : "outline")}${d.plugin ? html`<span>${d.plugin}</span>` : ""}</div>
    ${d.why ? html`<div class="appr-why"><span>${t("appr.why")}</span> ${String(d.why)}</div>` : ""}
    <div class="appr-t">${d.summary}</div>
    ${(d.items ?? []).length ? html`<ul>${join((d.items as string[]).map((x) => html`<li>${x}</li>`))}</ul>` : ""}
    ${d.shared ? html`<p class="appr-note">${d.askedBy ? t("appr.sharedAsked", { name: String(d.askedBy) }) : t("appr.shared")}</p>` : ""}
    <form class="appr-a" hx-post="/speca/approvals/${it.id}" hx-swap="none">
      <input type="hidden" name="hash" value="${d.previewHash}">
      ${k.button({ label: t("appr.reject"), variant: "outline", size: "sm", type: "submit", attrs: html`name="decision" value="rejected" data-key="esc"` })}
      ${k.button({ label: d.kind === "local" ? t("appr.allow") : t("appr.do"), variant: irreversible ? "destructive" : "primary", size: "sm", type: "submit", attrs: html`name="decision" value="approved" data-key="enter"` })}
    </form>
  </div>`;
}

function planReviewCard(cx: ChatCtx, it: Extract<Item, { k: "plan_review" }>): Raw {
  const { t } = cx;
  if (it.status) return k.banner({ cls: "e static", icon: it.status === "approved" ? "check" : "x", text: it.status === "approved" ? t("plan.approved") : t("plan.notApproved") });
  // the plan, then (for the owner) one line for what to change and ask to change · approve; the card is the form
  const head = html`<div class="appr-k">${k.pill(t("plan.review"), "outline")}</div><div class="md">${md(String(it.d.markdown ?? ""), cx.app)}</div>`;
  if (!decides(cx)) return html`<div class="e static appr plan-review" id="plan-${it.id}" tabindex="0">${head}</div>`;
  return html`<form class="e static appr plan-review" id="plan-${it.id}" tabindex="0" hx-post="/speca/approvals/${it.id}" hx-swap="none">${head}
    <input type="hidden" name="hash" value="${it.d.previewHash}">
    ${k.input({ name: "note", placeholder: t("plan.changePlaceholder"), attrs: html`aria-label="${t("plan.changePlaceholder")}"` })}
    <div class="appr-a">${k.button({ label: t("plan.change"), variant: "outline", size: "sm", type: "submit", attrs: html`name="decision" value="rejected"` })}${k.button({ label: t("plan.approve"), size: "sm", type: "submit", attrs: html`name="decision" value="approved"` })}</div>
  </form>`;
}

function questionCard(cx: ChatCtx, it: Extract<Item, { k: "question" }>): Raw {
  const { t } = cx;
  const qs = (it.d.questions ?? []) as Array<{ question: string; options?: string[]; recommended?: string; multiple?: boolean }>;
  if (it.answers) {
    return k.banner({ cls: "e static", icon: "check", text: join(qs.map((q, i) => html`<b>${q.question}</b> ${String((it.answers as Record<string, unknown>)[i] ?? (it.answers as Record<string, unknown>)[q.question] ?? "")}`), " · ") });
  }
  if (!decides(cx)) return k.banner({ cls: "e static", icon: "clock", text: t("q.waiting") });
  return html`<form class="e static appr question" id="q-${it.id}" hx-post="/speca/s/${cx.s.id}/answer/${it.id}" hx-swap="none">
    <div class="appr-k">${k.pill(t("q.title"), "outline")}</div>
    ${join(qs.map((q, i) => html`<fieldset class="q"><legend class="appr-t">${q.question}</legend>
      ${(q.options ?? []).length ? k.choices({ name: `a${i}`, type: q.multiple ? "checkbox" : "radio", items: (q.options ?? []).map((o) => ({ value: o, checked: o === q.recommended, label: o === q.recommended ? html`${o} ${k.pill(t("q.recommended"), "muted")}` : o })) }) : ""}
      ${k.input({ name: `o${i}`, placeholder: (q.options ?? []).length ? t("q.other") : t("q.answer"), attrs: html`aria-label="${t("q.answer")}"` })}
    </fieldset>`))}
    <div class="appr-a">${k.button({ label: t("q.skip"), variant: "ghost", size: "sm", type: "submit", attrs: html`name="skip" value="1"` })}${k.button({ label: t("q.send"), size: "sm", type: "submit" })}</div>
  </form>`;
}

function askAnswerCard(cx: ChatCtx, it: Extract<Item, { k: "ask_answer" }>): Raw {
  const p = it.d.provenance ?? {};
  return html`<div class="e static peer-answer">
    <div class="pa-h"><span class="pa">${initials(String(it.d.from ?? "?"))}</span><b>${it.d.from}</b><span class="sub">${cx.t("ask.answerVia")} · ${p.level === "history" ? cx.t("ask.levelHistory") : cx.t("ask.levelSummary")}${p.withheld ? ` · ${cx.t("ask.withheld")}` : ""}</span></div>
    <div class="md">${md(String(it.d.text ?? ""), cx.app)}</div>
  </div>`;
}

function itemHtml(cx: ChatCtx, it: Item, turn: Turn): Raw {
  const { t } = cx;
  switch (it.k) {
    case "user":
      return html`<div class="e static u" data-idx="${it.idx}">${it.attachments.length ? html`<div class="u-files">${join(it.attachments.map((a) => a.mime.startsWith("image/") ? html`<a class="u-img" href="/speca/files/${a.id}" target="_blank" rel="noopener"><img src="/speca/files/${a.id}" alt="${a.name}" loading="lazy"></a>` : html`<a class="u-file" href="/speca/files/${a.id}" target="_blank" rel="noopener">${ic("paperclip", "ic-xs")}${a.name}</a>`))}</div>` : ""}${it.text ? html`<div class="bubble">${withMentions(it.text, it.attachments)}</div>` : ""}${it.context.length ? html`<div class="u-ctx">${join(it.context.map((c) => html`<span class="cchip">${ic("at", "ic-xs")}<span class="mono">${c.title}</span></span>`))}</div>` : ""}<div class="when">${it.author && !it.author.startsWith("user:") ? html`${t("chat.fromAgent")} · ` : it.authorName ? html`<b class="u-who">${it.authorName}</b> · ` : ""}${it.steer ? html`${t("chat.steered")} · ` : ""}${clock(it.ts, cx.tzone)}</div></div>`;
    case "assistant":
      return html`<div class="e static a" data-idx="${it.idx}"><div class="md">${md(it.text, cx.app)}${it.streaming ? html`<span class="caret"></span>` : ""}</div>${it.interrupted ? html`<div class="note-line">${t("chat.interrupted")}</div>` : ""}${!it.streaming && it.final && !turn.open && !cx.readonly ? html`<div class="msg-acts">
        <button class="btn" data-variant="ghost" data-size="sm" hx-post="/speca/saved" hx-vals='${JSON.stringify({ kind: "message", session: cx.s.id, idx: it.idx })}' hx-swap="none">${ic("bookmark")}${t("chat.save")}</button>
        <button class="btn" data-variant="ghost" data-size="sm" data-act="copy-msg">${ic("copy")}${t("chat.copy")}</button>
        <button class="btn" data-variant="ghost" data-size="sm" hx-post="/speca/s/${cx.s.id}/fork" hx-vals='${JSON.stringify({ idx: it.idx })}'>${ic("fork")}${t("chat.forkHere")}</button></div>` : ""}</div>`;
    case "tools":
      return toolsGroup(cx, it, false, turn);
    case "approval":
      return approvalCard(cx, it);
    case "plan_review":
      return planReviewCard(cx, it);
    case "question":
      return questionCard(cx, it);
    case "canvas":
      return html`<button class="e static clink" data-act="open-tab" data-tab="${it.d.tabId}" hx-post="/speca/canvas/${it.d.tabId}/activate" hx-swap="none">${ic("appWindow", "ic-sm")}<span>${t("chat.openedCanvas")}</span><b>${it.d.title} · v${it.d.v ?? 1}</b>${ic("arrowUR", "ic-sm arrow")}</button>`;
    case "changes":
      return changesCard(cx, it.d);
    case "git":
      return gitLine(cx, it.d);
    case "ask_sent":
      return html`<div class="e static clink static-link">${ic("compass", "ic-sm")}<span>${t("ask.sent", { who: String(it.d.to ?? "") })}</span><b>${String(it.d.question ?? "").slice(0, 80)}</b></div>`;
    case "ask_answer":
      return askAnswerCard(cx, it);
    case "subagent":
      // the live card loads itself (status, steps, cost, its confirmations)
      return html`<div class="e static subcard" id="sub-${it.d.subId}" hx-get="/speca/sub/${it.d.subId}/card" hx-trigger="load" hx-swap="outerHTML"><div class="sc-h">${ic("bot", "ic-sm")}<b>${it.d.name}</b>${it.d.modelLabel ? k.pill(String(it.d.modelLabel), "muted") : ""}</div></div>`;
    case "subagent_result":
      return html`<details class="e static subres"><summary>${ic("bot", "ic-sm")}<span>${t("sub.report", { name: String(it.d.name ?? "") })}</span>${ic("chevDown", "ic-xs chev")}</summary><div class="md">${md(String(it.d.text ?? ""), cx.app)}</div></details>`;
    case "access_request":
      return html`<div class="e static reqcard">${ic("key", "ic-sm")}<div class="grow"><b>${t("req.sentTitle", { title: String(it.d.title ?? "") })}</b><small>${t("req.sentSub")}</small></div><span class="pill p2">${t("req.pending")}</span></div>`;
    case "btw":
      return btwCard(cx, it.idx, it.d);
    case "usage":
      return usageCard(cx, it.idx, it.d);
    case "merged": {
      const can = (it.d.canvases ?? []) as Array<{ title: string; how: string; conflicts: number }>;
      return html`<details class="e static subres merged"><summary>${ic("fork", "ic-sm")}<span>${t("merge.done", { title: String(it.d.title ?? "") })}</span><small>${t("merge.turns", { n: Number(it.d.turns ?? 0) })}</small>${ic("chevDown", "ic-xs chev")}</summary>
        ${(it.d.asks ?? []).length ? html`<div class="merged-asks">${join((it.d.asks as string[]).map((a) => html`<div class="bubble">${a}</div>`))}</div>` : ""}
        ${it.d.outcome ? html`<div class="md">${md(String(it.d.outcome), cx.app)}</div>` : ""}
        ${can.length ? html`<ul class="merged-can">${join(can.map((c) => html`<li>${ic("appWindow", "ic-xs")}<b>${c.title}</b> — ${t(`merge.how.${c.how}` as never)}${c.conflicts ? html` · ${t("merge.conflicts", { n: c.conflicts })}` : ""}</li>`))}</ul>` : ""}
        <a class="fork-line" href="/speca/s/${String(it.d.forkId ?? "")}">${ic("arrowUR", "ic-xs")}${t("merge.openBranch")}</a></details>`;
    }
    case "notice":
      return html`<div class="e static notice ${it.d.kind === "parked" ? "parked" : ""}">${ic(it.d.kind === "retry" ? "refresh" : it.d.kind === "budget" ? "gauge" : "clock", "ic-sm")}<span>${it.d.text}</span></div>`;
    case "note":
      // a schedule that fired shows its title; a resumed turn says why it goes on
      return html`<div class="e static note-line">${ic(it.d.kind === "trigger" ? "clock" : it.d.kind === "resume" ? "refresh" : "msg", "ic-xs")}<span>${it.d.kind === "resume" ? t("chat.resumed") : it.d.kind === "trigger" && it.d.title ? t("sched.fired", { title: String(it.d.title) }) : String(it.d.text ?? "").slice(0, 300)}</span></div>`;
  }
}

/** The line under a finished turn: how long it worked (and how many actions), what it read and wrote in tokens —
 *  and, when more than one model was at work (subagents, the cheap reader), how much each took, on a line of its own
 *  under it. One block that never breaks into pieces in a narrow chat. */
function workedLine(cx: ChatCtx, turn: Turn, actions = 0): Raw {
  const { t } = cx;
  const u = turn.tokens;
  const n = (v: number) => new Intl.NumberFormat(t.locale, { notation: "compact", maximumFractionDigits: 1 }).format(v);
  const main = [t("chat.worked", { time: dur(turn.ms ?? 0, t.locale) }), actions ? t("chat.actions", { n: actions }) : "", u ? t("chat.tokens", { n: n(u.in + u.cached + u.out) }) : ""].filter(Boolean).join(" · ");
  const tip = u ? t("chat.tokensDetail", { in: n(u.in), cached: n(u.cached), out: n(u.out) }) : "";
  const split = (u?.models ?? []).filter((m) => m.n > 0);
  return html`<span class="worked-t"${tip ? html` title="${tip}"` : ""}><span class="worked-m">${main}</span>${split.length > 1 ? html`<span class="worked-s">${split.map((m) => `${prettyModel(m.model)} ${n(m.n)}`).join(" · ")}</span>` : ""}</span>`;
}

const KEEP_VISIBLE = (i: Item) => i.k === "subagent" || i.k === "subagent_result" || i.k === "user" || (i.k === "assistant" && i.final) || i.k === "approval" || i.k === "plan_review" || i.k === "question" || i.k === "ask_answer" || i.k === "canvas" || i.k === "access_request" || i.k === "changes" || i.k === "git" || i.k === "merged" || i.k === "usage";

/** The work inside a folded turn (its steps, intermediate messages), drawn when the person opens it. */
export function workHtml(cx: ChatCtx, turn: Turn): Raw {
  return join(turn.items.filter((i) => !KEEP_VISIBLE(i)).map((i) => itemHtml(cx, i, turn)));
}

export function turnHtml(cx: ChatCtx, turn: Turn): Raw {
  const { t } = cx;
  const collapsed = collapses(turn);
  const keepVisible = KEEP_VISIBLE;
  let body: Raw;
  if (collapsed) {
    const users = turn.items.filter((i) => i.k === "user");
    const rest = turn.items.filter((i) => keepVisible(i) && i.k !== "user");
    const actions = turn.items.filter((i) => i.k === "tools").reduce((n, i) => n + (i.k === "tools" ? i.calls.length : 0), 0);
    // what the turn did comes when it is opened (GET /s/:id/work): a long chat's folded turns once made its page 2.6 MB
    body = html`${join(users.map((i) => itemHtml(cx, i, turn)))}
      <details class="e static worklog" data-from="${turn.startIdx}" data-to="${turn.lastIdx}"><summary class="worked">${workedLine(cx, turn, actions)}</summary><div class="worklog-in" hx-get="${turnRange(cx, turn).replace("{what}", "work")}" hx-trigger="toggle from:closest details once" hx-swap="innerHTML"><span class="skel skel-line"></span><span class="skel skel-line"></span></div></details>
      ${join(rest.map((i) => itemHtml(cx, i, turn)))}`;
  } else {
    body = html`${join(turn.items.map((i) => itemHtml(cx, i, turn)))}${turn.open && !turn.items.some((i) => i.k === "assistant" && i.streaming) && !turn.items.some((i) => i.k === "tools" && i.calls.some((c) => c.status !== "done")) && !turn.items.some((i) => (i.k === "approval" || i.k === "question" || i.k === "plan_review") && !("status" in i ? i.status : (i as { answers: unknown }).answers)) ? html`<div class="e live" hx-get="/speca/s/${cx.s.id}/activity" hx-trigger="load, every 2s" hx-swap="innerHTML"><i class="spin"></i><span class="shimmer">${t("chat.thinking")}</span></div>` : ""}`;
  }
  const tail = !turn.open && turn.reason && turn.reason !== "completed"
    ? html`<div class="e static turn-end ${turn.reason}">${ic(turn.reason === "cancelled" ? "square" : turn.reason === "parked" ? "clock" : "alert", "ic-sm")}<span>${t(`turn.${turn.reason}` as never)}${turn.error ? html`: ${turn.error}` : ""}</span></div>`
    : !turn.open && turn.reason === "completed" && !collapsed && ((turn.ms ?? 0) > 4000 || turn.tokens) ? html`<div class="e static worked">${workedLine(cx, turn)}</div>` : "";
  // where on a canvas it changed something: a way to each place (a design canvas's artboard), even in a folded turn
  const places = turn.places.length ? html`<div class="e static places">${ic("penTool", "ic-sm")}<span class="places-l">${t("chat.places")}</span>${join(turn.places.map((p) => html`<button type="button" class="place" hx-post="/speca/canvas/${p.tabId}/focus" hx-vals='${JSON.stringify({ focus: p.focus ?? "" })}' hx-swap="none" title="${t("chat.placeShow")}">${p.title}${ic("arrowUR", "ic-xs")}</button>`))}</div>` : "";
  // a fork that went off from this turn: a way to it, at the place it branched
  const forks = (cx.forks ?? []).filter((f) => f.idx >= turn.startIdx && f.idx <= turn.lastIdx);
  const forkMarks = join(forks.map((f) => html`<a class="e static fork-line" href="/speca/s/${f.id}">${ic("fork", "ic-sm")}<span>${t("chat.forkWent", { title: f.title || t("chat.newChat") })}</span>${ic("arrowUR", "ic-sm arrow")}</a>`));
  return html`<div class="turn" id="turn-${turn.id}" data-open="${turn.open}">${body}${places}${tail}${forkMarks}</div>`;
}

export function logHtml(cx: ChatCtx, events: EventRow[]): { html: Raw; maxIdx: number; turns: Turn[] } {
  const turns = fold(events);
  const maxIdx = events.length ? events[events.length - 1]!.idx : -1;
  return { html: join(turns.map((t) => turnHtml(cx, t))), maxIdx, turns };
}

/** The top of a chat shown from its middle: older turns load when it comes near (app.js, /s/:id/log?before=). */
export function olderMark(t: T, sid: string, before: number): Raw {
  return before > 0 ? html`<div class="log-more" data-before="${before}" data-src="/speca/s/${sid}/log?before=${before}" role="status" aria-label="${t("chat.loadingOlder")}"><i class="spin"></i></div>` : html``;
}

/** Tail update: new turns appended, changed turns replaced out of band, the marker moved. */
export function logTail(cx: ChatCtx, events: EventRow[], after: number): Raw {
  const turns = fold(events);
  const maxIdx = events.length ? events[events.length - 1]!.idx : -1;
  const fresh = turns.filter((t) => t.startIdx > after);
  const changed = turns.filter((t) => t.startIdx <= after && (t.open || t.lastIdx > after));
  return html`${join(fresh.map((t) => turnHtml(cx, t)))}${join(changed.map((t) => raw(turnHtml(cx, t).html.replace('<div class="turn"', '<div hx-swap-oob="outerHTML" class="turn"'))))}<div id="log-mark" hx-swap-oob="outerHTML" data-after="${maxIdx}" hidden></div>`;
}

export function emptyChat(cx: ChatCtx): Raw {
  const { t } = cx;
  if (cx.s.kind === "dev") {
    const sug = [t("dev.sug1"), t("dev.sug2"), t("dev.sug3")];
    return html`<div class="empty-chat"><span class="big">${ic("terminal")}</span><h3>${t("dev.title")}</h3><div>${t("dev.empty")}</div><div class="sugs">${join(sug.map((x) => html`<button class="sug" data-act="sug" data-v="${x}">${x}</button>`))}</div></div>`;
  }
  if (cx.code) {
    const sug = [t("code.sug.run"), t("code.sug.tour"), t("code.sug.fix"), cx.code.repo ? t("code.sug.pr") : t("code.sug.git")];
    return html`<div class="empty-chat code-empty"><span class="big">${ic("terminal")}</span><h3>${cx.s.title || t("code.chatTitle")}</h3>
      <div class="code-where">${cx.code.computer ? html`${ic("monitor", "ic-xs")}<span>${cx.code.computer.name} · ${cx.code.dir.replace(/^\/(Users|home)\/[^/]+/, "~")}</span><i class="comp-dot${cx.code.computer.online ? " on" : ""}" title="${cx.code.computer.online ? t("comp.online") : t("comp.off")}"></i>`
        : html`${ic(cx.code.repo ? "branch" : "folder", "ic-xs")}<span>${cx.code.repo ? cx.code.repo.replace(/^https:\/\/github\.com\//, "") : cx.code.dir.replace(/^\/Users\/[^/]+/, "~")}</span>`}</div>
      <div>${t("code.empty")}</div><div class="sugs">${join(sug.map((x) => html`<button class="sug" data-act="sug" data-v="${x}">${x}</button>`))}</div></div>`;
  }
  const sugs = cx.s.kind === "coordinator" ? [t("coord.sug1"), t("coord.sug2"), t("coord.sug3")] : [t("chat.sug1"), t("chat.sug2"), t("chat.sug3")];
  return html`<div class="empty-chat" style="--a:var(--signal)"><span class="big">${ic(cx.s.kind === "coordinator" ? "compass" : "sparkle")}</span><h3>${cx.s.kind === "coordinator" ? t("term.coordinator") : cx.s.title || t("chat.newChat")}</h3><div>${cx.s.kind === "coordinator" ? t("coord.empty") : t("chat.empty")}</div>
    <div class="sugs">${join(sugs.map((s) => html`<button class="sug" data-act="sug" data-v="${s}">${s}</button>`))}</div></div>`;
}

// ── header ────────────────────────────────────────────────────────────
/** How full the agent's context is (what its last request carried), with compact and clear in its menu. */
function ctxMeter(cx: ChatCtx): Raw {
  const { t, s } = cx;
  const c = s.engine_state.ctx as { used?: number; window?: number | null } | undefined;
  if (!decides(cx) || !c?.used) return html``;
  const ru = t.locale === "ru";
  const fmt = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)} ${ru ? "млн" : "M"}` : `${Math.round(n / 1000)} ${ru ? "тыс." : "k"}`);
  const pct = c.window ? Math.min(100, Math.round((c.used / c.window) * 100)) : null;
  const label = pct != null ? t("ctx.used", { used: fmt(c.used), window: fmt(c.window!), pct }) : t("ctx.usedNoWin", { used: fmt(c.used) });
  const item = (cmd: string, icon: string, name: string, hint: string) => html`<div role="menuitem" hx-post="/speca/s/${s.id}/messages" hx-vals='${JSON.stringify({ text: `/${cmd}` })}' hx-swap="none">${ic(icon)}<span>${name}<br><small class="muted">${hint}</small></span></div>`;
  return html`<div class="dropdown-menu ctx-meter" id="ctx-${s.id}"><button type="button" id="ctx-${s.id}-trigger" class="btn${pct != null && pct >= 80 ? " ctx-full" : ""}" data-variant="ghost" data-size="icon-sm" aria-haspopup="menu" aria-controls="ctx-${s.id}-menu" aria-expanded="false" aria-label="${label}" data-tooltip="${label}" data-side="bottom">${ring((pct ?? 0) / 100)}</button>
    <div id="ctx-${s.id}-popover" data-popover aria-hidden="true" data-side="bottom" data-align="end"><div role="menu" id="ctx-${s.id}-menu" aria-labelledby="ctx-${s.id}-trigger">
      <div role="heading">${label}</div>
      ${s.engine_state.ccSessionId || s.engine_state.codexThreadId ? item("compact", "layers", t("ctx.compact"), t("ctx.compactHint")) : ""}
      ${item("clear", "refresh", t("ctx.clear"), t("ctx.clearHint"))}
    </div></div></div>`;
}

function ring(pct: number): Raw {
  const L = 37.7;
  return raw(`<svg class="ring" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="var(--line-strong)" stroke-width="2"/><circle cx="8" cy="8" r="6" fill="none" stroke="var(--signal)" stroke-width="2" stroke-dasharray="${L}" stroke-dashoffset="${(L * (1 - pct)).toFixed(2)}" transform="rotate(-90 8 8)" stroke-linecap="round"/></svg>`);
}

export function statusLine(cx: ChatCtx): Raw {
  const { t, s } = cx;
  if (s.kind === "coordinator") return html`<span>${t("coord.sub")}</span>`;
  if (s.kind === "dev" && s.status !== "running" && s.status !== "waiting") return html`<span class="st dev-badge">${ic("terminal", "ic-xs")}${t("dev.badge")}</span>`;
  if (cx.readonly) return html`<span class="st">${ic("eye", "ic-xs")}${t("chat.readonlyOf", { name: cx.owner.name })}</span>`;
  switch (s.status) {
    case "running": return html`<span class="st st-running"><i class="spin"></i>${t("status.running")}</span>`;
    case "waiting": return html`<span class="st st-waiting"><i class="dot"></i>${t("status.waiting")}</span>`;
    case "error": return html`<span class="st st-error"><i class="dot"></i>${t("status.error")}</span>`;
    case "parked": return html`<span class="st st-paused">${ic("clock", "ic-xs")}${t("status.parked")}</span>`;
    default: return html`<span class="st">${t("status.idle")}</span>`;
  }
}

export function chatHead(cx: ChatCtx): Raw {
  const { t, s } = cx;
  // a plan shows for bigger tasks only (3+ steps); a short one is the agent's own business
  const plan = (s.plan ?? []).length >= 3 ? s.plan! : [];
  const done = plan.filter((p) => p.status === "completed").length;
  const curI = plan.findIndex((p) => p.status === "in_progress");
  const step = plan.length ? (done === plan.length ? t("plan.allDone", { n: plan.length }) : t("plan.step", { i: (curI >= 0 ? curI : done) + 1, n: plan.length })) : null;
  return html`<header class="chat-head" id="chat-head" hx-get="/speca/s/${s.id}/head" hx-trigger="dh-live, every 30s" hx-swap="outerHTML" data-live-topic="session:${s.id}">
    <span class="avs"><span class="av agent" style="--a:var(--signal)">${ic(s.kind === "coordinator" ? "compass" : s.kind === "dev" ? "terminal" : "sparkle")}</span><span class="av human">${initials(cx.owner.name)}</span></span>
    <div class="chat-ttl"><div class="n" data-act="rename" title="${t("chat.renameHint")}">${s.kind === "coordinator" ? t("term.coordinator") : s.title || (s.kind === "dev" ? t("dev.title") : t("chat.newChat"))}</div><div class="s">${statusLine(cx)}${cx.forkOf ? html`<a class="fork-of" href="/speca/s/${cx.forkOf.id}" data-tooltip="${t("chat.forkOfHint")}" data-side="bottom">${ic("fork", "ic-xs")}<span>${t("chat.forkedFrom", { title: cx.forkOf.title || t("chat.newChat") })}</span></a>` : ""}</div></div>
    <div class="acts">
      ${ctxMeter(cx)}
      ${step ? html`<button class="stepchip hide-m" data-act="show-progress" aria-label="${t("plan.progress")}">${ring(plan.length ? done / plan.length : 0)}<span>${step}</span></button>` : ""}
      <button class="btn" data-variant="ghost" data-size="icon-sm" data-act="view-menu" aria-label="${t("view.title")}" data-tooltip="${t("view.title")} · ⌘1–6" data-side="bottom" data-align="end">${ic("layout")}</button>
      ${cx.code && !cx.readonly ? html`<button class="btn" data-variant="ghost" data-size="icon-sm" hx-post="/speca/s/${s.id}/files/open" hx-swap="none" aria-label="${t("pfiles.open")}" data-tooltip="${t("pfiles.open")}" data-side="bottom">${ic("folderTree", "ic-sm")}</button>` : ""}
      ${cx.code ? runCtl(cx.t, cx.code, s.id) : ""}
      ${cx.preview && !cx.readonly ? html`<button class="btn" data-variant="ghost" data-size="icon-sm" hx-post="/speca/s/${s.id}/preview" hx-swap="none" aria-label="${t("code.openPreview")}" data-tooltip="${t("code.openPreviewTip", { url: cx.preview })}" data-side="bottom">${ic("globe", "ic-sm")}</button>` : ""}
      ${s.shared_write ? html`<span class="pill shared-pill" data-tooltip="${t("collab.pillHint")}" data-side="bottom">${ic("users", "ic-xs")}${t("collab.pill")}</span>` : ""}
      ${!decides(cx) ? "" : html`<div class="dropdown-menu" id="sm-${s.id}"><button type="button" id="sm-${s.id}-trigger" class="btn" data-variant="ghost" data-size="icon-sm" aria-haspopup="menu" aria-controls="sm-${s.id}-menu" aria-expanded="false" aria-label="${t("chat.menu")}">${ic("more")}</button>
        <div id="sm-${s.id}-popover" data-popover aria-hidden="true" data-side="bottom" data-align="end"><div role="menu" id="sm-${s.id}-menu" aria-labelledby="sm-${s.id}-trigger">
          <div role="menuitem" data-act="rename">${ic("pencil")}${t("chat.rename")}<span data-shortcut>F2</span></div>
          <div role="menuitem" hx-post="/speca/s/${s.id}/fork">${ic("fork")}${t("chat.fork")}</div>
          ${cx.forkOf && s.owner_id === cx.me.id ? html`<div role="menuitem" data-dialog="/speca/s/${s.id}/merge">${ic("merge")}${t("merge.into", { title: cx.forkOf.title || t("chat.newChat") })}</div>` : ""}
          <div role="menuitem" hx-post="/speca/s/${s.id}/pin" hx-swap="none">${ic(s.pinned ? "pinOff" : "pin")}${s.pinned ? t("chat.unpin") : t("chat.pin")}</div>
          <div role="menuitem" data-dialog="/speca/s/${s.id}/access">${ic("shield")}${t("chat.access")}</div>
          <a role="menuitem" href="/speca/artifacts?session=${s.id}">${ic("layers")}${t("art.ofThisChat")}</a>
          ${s.project_id && s.kind === "chat" ? html`<div role="menuitemcheckbox" aria-checked="${s.shared_write}" hx-post="/speca/s/${s.id}/shared" hx-vals='${JSON.stringify({ on: s.shared_write ? "0" : "1" })}' hx-swap="none">${ic("users")}<span>${t("collab.toggle")}<br><small class="muted">${t("collab.toggleHint")}</small></span></div>` : ""}
          <hr role="separator">
          ${s.status === "running" || s.status === "waiting" ? html`<div role="menuitem" hx-post="/speca/s/${s.id}/stop" hx-swap="none">${ic("square")}${t("chat.stop")}</div>` : ""}
          ${s.kind !== "coordinator" ? html`<div role="menuitem" hx-post="/speca/s/${s.id}/archive" hx-confirm="${s.status === "running" ? t("chat.archiveRunning") : t("chat.archiveConfirm")}">${ic("archive")}${t("chat.archive")}</div>` : ""}
        </div></div></div>`}
    </div>
  </header>`;
}

// ── queue dock and composer ───────────────────────────────────────────
export function queueDock(cx: ChatCtx, pending: InboxRow[], echo?: { key: string; text: string }): Raw {
  const { t } = cx;
  const items = pending.filter((p) => p.kind === "user_message");
  const busy = cx.s.status === "running" || cx.s.status === "waiting";
  return html`<div id="qdock" class="qdock" hx-get="/speca/s/${cx.s.id}/qdock" hx-trigger="dh-live" hx-swap="outerHTML" data-live-topic="session:${cx.s.id}">
    ${echo ? html`<div class="q-item echo" id="echo-${echo.key}">${ic("clock", "ic-xs")}<span class="grow">${echo.text}</span><small>${t("chat.sending")}</small></div>` : ""}
    ${items.length && busy ? join(items.map((i) => html`<div class="q-bubble">
      <div class="q-text">${String(i.payload.text ?? "").slice(0, 400)}</div>
      <div class="q-foot">${k.status({ tone: i.delivery === "steer" ? undefined : "off", text: i.delivery === "steer" ? t("chat.steerSoon") : t("chat.queuedOne") })}<span class="grow"></span>
        ${i.delivery === "steer" ? "" : k.button({ icon: "arrowUp", variant: "ghost", size: "icon-sm", tooltip: t("chat.steerNow"), side: "top", attrs: html`hx-post="/speca/s/${cx.s.id}/inbox/${i.id}/steer" hx-swap="none"` })}
        ${k.button({ icon: "x", variant: "ghost", size: "icon-sm", tooltip: t("chat.unqueue"), side: "top", attrs: html`hx-post="/speca/s/${cx.s.id}/inbox/${i.id}/cancel" hx-swap="none"` })}</div></div>`)) : ""}
  </div>`;
}

/** When something comes, as a person reads it: "in 25 min" within a day, else its day and time. */
function whenText(cx: ChatCtx, at: Date | string | null): string {
  if (!at) return "";
  const d = new Date(at), ms = d.getTime() - Date.now();
  if (ms < 86_400_000) return cx.t("sched.in", { in: durMin(ms, cx.t.locale) });
  return new Intl.DateTimeFormat(cx.t.locale, { timeZone: cx.tzone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
}

/** What the chat has scheduled (runtime/triggers.ts) — wake-ups, schedules, watches the agent set: one quiet line each
 *  over the composer (what, when next, cancel); more than two fold under "Scheduled · n". Redrawn with the chat. */
export function schedDock(cx: ChatCtx, rows: TriggerRow[]): Raw {
  const { t, s } = cx;
  const line = (r: TriggerRow) => {
    const w = r.spec.watch;
    const when = w ? (w.contains ? t("sched.waitsFor", { text: w.contains, n: w.every }) : t("sched.watch", { n: w.every }))
      : r.kind === "cron" ? t("sched.cron", { when: whenText(cx, r.next_fire_at) }) : whenText(cx, r.next_fire_at);
    const tip = w ? `${w.kind === "command" ? "$ " : ""}${w.target}` : r.spec.cron ? `${r.spec.cron} · ${r.spec.tz ?? ""}` : "";
    return html`<div class="q-item sched-i"${tip ? html` title="${tip}"` : ""}>${ic(w ? "eye" : "clock", "ic-xs")}<span class="grow">${String(r.spec.title ?? r.prompt ?? "").slice(0, 120)}</span><small>${when}</small>
      ${decides(cx) ? k.button({ icon: "x", variant: "ghost", size: "icon-xs", tooltip: t("sched.cancel"), side: "top", attrs: html`hx-post="/speca/s/${s.id}/schedules/${r.id}/cancel" hx-swap="none"` }) : ""}</div>`;
  };
  const body = rows.length > 2 ? html`<details class="sched-d"><summary class="q-item">${ic("clock", "ic-xs")}<span class="grow">${t("sched.n", { n: rows.length })}</span><small>${whenText(cx, rows[0]!.next_fire_at)}</small>${ic("chevDown", "ic-xs chev")}</summary>${join(rows.map(line))}</details>`
    : join(rows.map(line));
  return html`<div id="sched-${s.id}" class="sched" hx-get="/speca/s/${s.id}/schedules" hx-trigger="dh-live" hx-swap="outerHTML" data-live-topic="session:${s.id}">${body}</div>`;
}

// the model picker (T3 Code look): sources on a rail, search, a name over its source, ⌘1…⌘9, the current one checked
const isClaude = (m: ModelOption) => m.engine === "claude-code" || m.type === "anthropic";
const modelName = (m: ModelOption) => { const n = m.label.split(" · ").slice(1).join(" · ") || m.alias; return isClaude(m) && !/^claude/i.test(n) ? `Claude ${n}` : n; };
const vendorOf = (m: ModelOption) => (isClaude(m) ? "claude" : m.type === "openai" || m.engine === "codex" ? "openai" : "other");
const hasEffort = (m: ModelOption) => isClaude(m) || m.engine === "codex";
const srcIcon = (m: ModelOption) => ({ claude: "claude", openai: "bot", other: "cpu" })[vendorOf(m)];
function modelPicker(cx: ChatCtx, cur: ModelOption | undefined): Raw {
  const { t, s } = cx;
  const models = cx.models.filter((x) => s.kind !== "dev" || x.engine === "claude-code");
  // the rail: one button per maker (Claude, OpenAI, …) filters the list; "+" adds models
  const vendors = new Map<string, ModelOption>();
  for (const m of models) if (!vendors.has(vendorOf(m))) vendors.set(vendorOf(m), m);
  const vendorName = (v: string) => (v === "claude" ? "Claude" : v === "openai" ? "OpenAI" : t("models.other"));
  const have = new Set(cx.models.map((m) => m.type));
  const missing = s.kind === "dev" ? [] : PERSONAL_KINDS.map((k) => k.type).filter((k) => !have.has(k));
  const srcName = (m: ModelOption) => `${m.label.split(" · ")[0]}${m.personal ? ` · ${t("models.personal")}` : ""}`;
  return html`<div class="mp-wrap"><button type="button" class="btn perm model-btn" data-variant="ghost" data-size="sm" data-act="mpick" aria-haspopup="dialog" aria-expanded="false">${ic(cur ? srcIcon(cur) : "cpu", "ic-sm")}<span>${cur ? modelName(cur) : s.model}</span>${ic("chevDown", "ic-xs")}</button>
    <div class="mpick" hidden data-session="${s.id}" role="dialog" aria-label="${t("models.search")}">
      <div class="mp-rail">${join([...vendors.keys()].map((v) => html`<button type="button" class="mp-src" data-src="${v}" aria-current="false" data-tooltip="${vendorName(v)}" data-side="right">${ic(v === "claude" ? "claude" : v === "openai" ? "bot" : "cpu")}</button>`))}
        <span class="grow"></span><button type="button" class="mp-src mp-plus" data-dialog="/speca/settings/models?dlg=1&from=${encodeURIComponent(`/speca/s/${s.id}`)}" data-tooltip="${t("models.add")}" data-side="right">${ic("plus")}</button></div>
      <div class="mp-main"><label class="mp-search">${ic("search", "ic-sm")}<input type="text" placeholder="${t("models.search")}" autocomplete="off" spellcheck="false"></label>
        <div class="mp-list" role="listbox">${join(models.map((m) => html`<button type="button" class="mp-i" role="option" data-ref="${m.ref}" data-src="${vendorOf(m)}" data-effort="${hasEffort(m) ? "1" : "0"}" data-q="${`${modelName(m)} ${srcName(m)} ${m.alias} ${m.model}`.toLowerCase()}" aria-selected="${m.ref === s.model}"><span class="grow"><span class="mp-n">${modelName(m)}</span><span class="mp-s">${ic(srcIcon(m), "ic-xs")}${srcName(m)}</span></span><kbd class="mp-k"></kbd><span class="mp-ok">${ic("check", "ic-sm")}</span></button>`))}
          <div class="mp-none" hidden>${t("models.none")}</div>
          ${missing.length ? html`<div class="mp-h">${t("mc.section")}</div>${join(missing.map((k) => html`<button type="button" class="mp-i mp-conn" data-dialog="/speca/models/connect?type=${k}&session=${s.id}" data-src="" data-q="${`${t(`mc.${k}` as never)} ${t(`mc.hint.${k}` as never)}`.toLowerCase()}"><span class="grow"><span class="mp-n">${t(`mc.${k}` as never)}</span><span class="mp-s">${ic(k === "openai" || k === "codex" ? "bot" : "burst", "ic-xs")}${t(`mc.hint.${k}` as never)}</span></span><span class="pill p2">${t("mc.connect")}</span></button>`))}` : ""}</div></div>
    </div></div>`;
}

const AUTONOMY: Array<["read_only" | "ask" | "drafts" | "full", string]> = [["read_only", "eye"], ["ask", "shieldCheck"], ["drafts", "zap"], ["full", "unlock"]];

/** What a turn changed in the project's folder (T3-style): "N files changed +X −Y", the folders as a tree with their
 *  counts, each file opening the diff. */
export function changesCard(cx: ChatCtx, d: Record<string, any>): Raw {
  const { t, s } = cx;
  type F = { path: string; status: string; add: number; del: number };
  const files = (d.files ?? []) as F[];
  // folders, single-child chains folded into one row ("config/presets")
  type Dir = { name: string; dirs: Map<string, Dir>; files: F[]; add: number; del: number };
  const root: Dir = { name: "", dirs: new Map(), files: [], add: 0, del: 0 };
  for (const f of files) {
    const parts = f.path.split("/"); let at = root;
    for (const p of parts.slice(0, -1)) { if (!at.dirs.has(p)) at.dirs.set(p, { name: p, dirs: new Map(), files: [], add: 0, del: 0 }); at = at.dirs.get(p)!; at.add += f.add; at.del += f.del; }
    at.files.push(f);
  }
  const fold = (dir: Dir): Dir => { while (dir.dirs.size === 1 && !dir.files.length) { const only = [...dir.dirs.values()][0]!; dir = { ...only, name: dir.name ? `${dir.name}/${only.name}` : only.name }; } return dir; };
  const nums = (a: number, b: number) => html`<span class="chg-n"><i class="add">+${a}</i><i class="del">−${b}</i></span>`;
  const open = (path?: string) => raw(`hx-post="/speca/s/${s.id}/changes/open" hx-vals='${JSON.stringify({ turn: d.turnId, ...(path ? { file: path } : {}) }).replace(/'/g, "&#39;")}' hx-swap="none"`);
  const row = (f: F): Raw => html`<button type="button" class="chg-f" ${open(f.path)} title="${f.path}"><span class="chg-st st-${f.status}">${f.status}</span><span class="chg-name">${f.path.split("/").pop()}</span>${nums(f.add, f.del)}</button>`;
  const tree = (dir: Dir, depth: number): Raw => html`${join([...dir.dirs.values()].map(fold).map((x) => html`<details class="chg-d" ${depth < 1 ? raw("open") : ""}><summary>${ic("chevRight", "ic-xs chev")}${ic("folder", "ic-xs")}<span class="chg-name">${x.name}</span>${nums(x.add, x.del)}</summary><div class="chg-in">${tree(x, depth + 1)}</div></details>`))}${join(dir.files.map(row))}`;
  const n = files.length + Number(d.more ?? 0);
  const revert = decides(cx) ? html`<button type="button" class="btn" data-variant="ghost" data-size="icon-sm" hx-post="/speca/s/${s.id}/changes/revert" hx-vals='${JSON.stringify({ turn: d.turnId })}' hx-swap="none" hx-confirm="${t("chg.revertConfirm", { n })}" aria-label="${t("chg.revert")}" data-tooltip="${t("chg.revert")}" data-side="top">${ic("undo", "ic-sm")}</button>` : "";
  return html`<div class="e static chg-card"><div class="chg-h">${ic(d.revertOf ? "undo" : d.by ? "pencil" : "fileDiff", "ic-sm")}<b>${d.revertOf ? t("chg.revertCard", { n }) : d.by ? t("chg.byHand", { n }) : t("chg.files", { n })}</b>${nums(Number(d.added ?? 0), Number(d.removed ?? 0))}<span class="grow"></span>${revert}<button type="button" class="btn" data-variant="ghost" data-size="icon-sm" ${open()} aria-label="${t("chg.open")}" data-tooltip="${t("chg.open")}" data-side="top">${ic("panelRight", "ic-sm")}</button></div><div class="chg-tree">${tree(fold(root), 0)}</div></div>`;
}

/** What the person did with git from the chat head: one quiet line (a pull request links out). */
function gitLine(cx: ChatCtx, d: Record<string, any>): Raw {
  const { t } = cx;
  const icon = d.kind === "pr" ? "pr" : d.kind === "push" ? "upload" : d.kind === "commit" ? "check" : "branch";
  const text = d.kind === "commit" ? html`${t("git.line.commit", { sha: d.sha ?? "", branch: d.branch ?? "" })} · ${d.message ?? ""}`
    : d.kind === "pr" ? html`<a href="${d.url}" target="_blank" rel="noopener">${t("git.line.pr", { n: d.number ?? "" })}</a> · ${d.title ?? ""}`
    : t(`git.line.${d.kind === "push" ? "push" : d.kind === "branch" ? "branch" : "switch"}` as never, { branch: d.branch ?? "" });
  return k.banner({ cls: "e static git-line", oneLine: true, icon, text });
}

/** A code project's chat: the branch its folder is on, by the send button; refreshed with the chat's events (the
 *  agent's git checkout shows at once) — not while its menu is open (app.js). With the folder's git state, the owner gets the
 *  menu: switch or create a branch, commit, push, open a pull request (runtime/git.ts). */
export function branchChip(t: T, code: { projectId: string; dir: string; branch: string | null }, sid: string, g?: GitState | null, canAct = false): Raw {
  const id = `git-${sid}`;
  const live = raw(`hx-get="/speca/projects/${code.projectId}/branch?s=${sid}" hx-trigger="${g === undefined ? "load, " : ""}dh-live" hx-target="this" hx-swap="outerHTML" data-live-topic="session:${sid}"`);
  const branch = g?.branch ?? (g?.detached ? t("git.detached") : code.branch);
  // the branch's name leads the tooltip: in a narrow composer the chip shows only its mark
  const tip = [branch ?? "", code.dir, g?.upstream ? `${g.upstream} ↑${g.ahead} ↓${g.behind}` : "", g?.changes.length ? t("git.changes", { n: g.changes.length }) : ""].filter(Boolean).join(" · ");
  const label = html`${ic("branch", "ic-xs")}<span>${branch ?? ""}</span>${g?.changes.length ? html`<i class="git-dot"></i>` : ""}${g?.ahead ? html`<small>↑${g.ahead}</small>` : ""}`;
  if (!g || !canAct) return html`<span class="cbar-branch" id="${id}" ${live}${branch ? raw(` data-tooltip="${tip.replace(/"/g, "&quot;")}" data-side="top" data-align="end"`) : raw(" hidden")}>${label}</span>`;
  const post = (url: string, vals?: Record<string, string>) => raw(`hx-post="/speca/s/${sid}/git/${url}"${vals ? ` hx-vals='${JSON.stringify(vals).replace(/'/g, "&#39;")}'` : ""} hx-swap="none"`);
  const off = (on: boolean) => raw(on ? "" : ` aria-disabled="true"`);
  return html`<div class="dropdown-menu cbar-git" id="${id}" ${live}><button type="button" id="${id}-trigger" class="cbar-branch" aria-haspopup="menu" aria-controls="${id}-menu" aria-expanded="false" data-tooltip="${tip}" data-side="top" data-align="end">${label}</button>
    <div id="${id}-popover" data-popover aria-hidden="true" data-side="top" data-align="end"><div role="menu" id="${id}-menu" aria-labelledby="${id}-trigger">
      <div role="group"><div role="heading">${t("git.branches")}</div>
        ${join(g.branches.slice(0, 10).map((b) => html`<div role="menuitem" ${b === g.branch ? raw(`aria-current="true"`) : post("switch", { name: b })}>${ic(b === g.branch ? "check" : "branch")}<span>${b}</span></div>`))}
        <div role="menuitem" data-dialog="/speca/s/${sid}/git/branch">${ic("plus")}<span>${t("git.newBranch")}</span></div>
      </div><hr role="separator">
      <div role="menuitem" data-dialog="/speca/s/${sid}/git/commit"${off(g.changes.length > 0)}>${ic("check")}<span>${t("git.commit")}${g.changes.length ? html` <small class="muted">${g.changes.length}</small>` : ""}</span></div>
      ${g.remote ? html`<div role="menuitem" ${post("push")}${off(!!g.branch)}>${ic("upload")}<span>${t("git.push")}${g.ahead || !g.upstream ? html` <small class="muted">${g.upstream ? `↑${g.ahead}` : t("git.notPushed")}</small>` : ""}</span></div>` : ""}
      ${g.github ? html`<div role="menuitem" ${post("pr")} hx-confirm="${t("git.prConfirm", { branch: g.branch ?? "" })}"${off(!!g.branch && !!g.upstream)}>${ic("pr")}<span>${t("git.pr")}</span></div>` : ""}
    </div></div></div>`;
}

/** The dev run of a code project in the chat head: what runs (live), its log, stop; or a menu of scripts to run. */
export function runCtl(t: T, code: CodeCtx, sid: string): Raw {
  const r = code.run;
  const live = html`hx-get="/speca/projects/${code.projectId}/run?s=${sid}" hx-trigger="dh-live" hx-swap="outerHTML" data-live-topic="project:${code.projectId}"`;
  if (r?.running) return html`<div class="run-ctl" id="run-${code.projectId}" ${live}><button class="btn run-on" data-variant="ghost" data-size="icon-sm" data-dialog="/speca/projects/${code.projectId}/log" aria-label="${t("run.runningTip", { name: r.name })}" data-tooltip="${t("run.runningTip", { name: r.name })}" data-side="bottom">${ic("terminal", "ic-sm")}<i class="run-dot"></i></button>
    ${code.canRun ? html`<button class="btn" data-variant="ghost" data-size="icon-sm" hx-post="/speca/projects/${code.projectId}/run/stop" hx-swap="none" aria-label="${t("run.stop")}" data-tooltip="${t("run.stop")}" data-side="bottom">${ic("square", "ic-sm")}</button>` : ""}</div>`;
  if (!code.canRun || !code.scripts.length) return html`<div class="run-ctl" id="run-${code.projectId}" ${live}>${r ? html`<button class="btn" data-variant="ghost" data-size="icon-sm" data-dialog="/speca/projects/${code.projectId}/log" aria-label="${t("run.lastLog")}" data-tooltip="${t("run.lastLog")}" data-side="bottom">${ic("terminal", "ic-sm")}</button>` : ""}</div>`;
  return html`<div class="run-ctl" id="run-${code.projectId}" ${live}><div class="dropdown-menu" id="rm-${code.projectId}"><button type="button" id="rm-${code.projectId}-trigger" class="btn" data-variant="ghost" data-size="icon-sm" aria-haspopup="menu" aria-controls="rm-${code.projectId}-menu" aria-expanded="false" aria-label="${t("run.start")}" data-tooltip="${t("run.start")}" data-side="bottom">${ic("play", "ic-sm")}</button>
    <div id="rm-${code.projectId}-popover" data-popover aria-hidden="true" data-side="bottom" data-align="end"><div role="menu" id="rm-${code.projectId}-menu" aria-labelledby="rm-${code.projectId}-trigger">
      <div role="group"><div role="heading">${t("run.heading")}</div>
      ${join(code.scripts.slice(0, 14).map((sc) => html`<div role="menuitem" hx-post="/speca/projects/${code.projectId}/run" hx-vals='${JSON.stringify({ name: sc.name, s: sid })}' hx-swap="none">${ic("play")}<span>${sc.name}<br><small class="muted">${sc.command}</small></span></div>`))}</div>
      ${r ? html`<hr role="separator"><div role="menuitem" data-dialog="/speca/projects/${code.projectId}/log">${ic("terminal")}${t("run.lastLog")}</div>` : ""}
    </div></div></div></div>`;
}

/** "/speca/btw": a side question and its answer; not part of the agent's history. Polls itself until answered. */
export function btwCard(cx: ChatCtx, idx: number, d: Record<string, any>): Raw {
  const { t } = cx;
  const waiting = d.status === "thinking";
  // a panel: the question as its title, "not in the agent's history" as a tag, the answer under it
  return k.panel({ cls: "e static", icon: "msg", title: String(d.text ?? ""), actions: k.pill(t("slash.btwNote"), "muted"),
    attrs: html`id="btw-${idx}" ${waiting ? html`hx-get="/speca/s/${cx.s.id}/btw/${idx}" hx-trigger="load delay:1500ms" hx-swap="outerHTML"` : ""}`,
    body: waiting ? html`<span class="btw-wait">${t("slash.btwThinking")}</span>` : d.status === "error" ? html`<div class="btw-a err">${String(d.answer ?? "")}</div>` : html`<div class="md">${md(String(d.answer ?? ""), cx.app)}</div>` });
}

/** "/speca/usage": how much of the person's plan is used (runtime/plan-usage.ts) — theirs alone: in a shared chat nobody else
 *  sees it. Polls itself until the numbers come. */
export function usageCard(cx: ChatCtx, idx: number, d: Record<string, any>): Raw {
  const { t } = cx;
  if (d.author !== `user:${cx.me.id}`) return html``;
  const loading = d.status === "loading";
  const rows = (d.rows ?? []) as UsageRow[];
  const when = (iso: string | null) => {
    if (!iso) return "";
    const ms = new Date(iso).getTime() - Date.now();
    if (ms < 86_400_000) return t("usage.resetsIn", { in: durMin(ms, t.locale) });
    return t("usage.resetsAt", { when: new Intl.DateTimeFormat(t.locale, { timeZone: cx.tzone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) });
  };
  const money = (n: number, cur: string) => new Intl.NumberFormat(t.locale, { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n);
  const label = (r: UsageRow) => r.key === "session" ? t("usage.session") : r.key === "week" ? t("usage.week")
    : r.key === "extra" ? t("usage.extra") : t("usage.weekOf", { model: r.name ?? (r.key === "opus" ? "Opus" : "Sonnet") });
  const sub = (r: UsageRow) => r.spent ? (r.spent.limit != null ? t("usage.spentOf", { used: money(r.spent.used, r.spent.currency), limit: money(r.spent.limit, r.spent.currency) }) : money(r.spent.used, r.spent.currency)) : when(r.resetsAt);
  const body = loading ? html`<span class="skel skel-line"></span><span class="skel skel-line"></span>`
    : d.status === "done" && rows.length ? html`${k.meters(rows.map((r) => ({ label: label(r), pct: r.pct, sub: sub(r), ...(r.pct >= 90 ? { tone: "bad" as const } : {}) })))}
      <p class="usage-f">${t("usage.asOf", { source: String(d.source ?? ""), time: new Intl.DateTimeFormat(t.locale, { timeZone: cx.tzone, hour: "2-digit", minute: "2-digit" }).format(new Date(Number(d.at) || Date.now())) })}</p>`
    : html`<p class="usage-f">${d.status === "error" ? t("usage.failed", { error: String(d.text ?? "") }) : t("usage.none")}</p>`;
  const plan = typeof d.plan === "string" && d.plan ? d.plan[0]!.toUpperCase() + d.plan.slice(1) : "";
  return k.panel({ cls: "e static usage-card", icon: "gauge", title: t("usage.title"), actions: plan ? k.pill(plan, "muted") : undefined,
    attrs: html`id="usage-${idx}" ${loading ? html`hx-get="/speca/s/${cx.s.id}/usage/${idx}" hx-trigger="load delay:800ms" hx-swap="outerHTML"` : ""}`, body });
}

/** The open canvas tab as context of the next message; follows the tab the person switches to. */
const ctxChip = (t: T, tab: { id: string; title: string }) => html`<span class="cchip ctx" data-tab="${tab.id}">${ic("at", "ic-xs")}<span class="mono">${tab.title}</span><input type="hidden" name="ctx_tab" value="${tab.id}"><button type="button" data-act="chip-x" aria-label="${t("composer.dropTab")}">${ic("x", "ic-xs")}</button></span>`;

export function composer(cx: ChatCtx, activeTab: { id: string; title: string } | null): Raw {
  const { t, s } = cx;
  const a = AUTONOMY.find(([k]) => k === s.autonomy) ?? AUTONOMY[1]!;
  const busy = s.status === "running" || s.status === "waiting";
  const cur = cx.models.find((m) => m.ref === s.model);
  // effort: Claude models (Claude Code and the Anthropic API); the chat's own choice, else the person's default
  const effortOn = !!cur && hasEffort(cur);
  const effort = s.effort ?? cx.me.settings.defaultEffort ?? null;
  const owner = cx.me.id === s.owner_id;
  const cmds: Array<[string, string | null, boolean]> = [["btw", "argBtw", false], ["plan", "argPlan", true], ["model", "argModel", true], ["effort", "argEffort", true], ["new", "argNew", false], ["compact", null, true], ["clear", null, true], ["usage", null, false], ["rename", "argRename", true], ["stop", null, false]];
  const slash = cmds.filter(([, , own]) => owner || !own).filter(([c]) => s.kind !== "dev" || c !== "plan").map(([c, arg]) => ({ c, a: arg ? t(`slash.${arg}` as never) : "", d: t(`slash.${c}` as never) }));
  return html`<form class="composer" id="composer" hx-post="/speca/s/${s.id}/messages" hx-target="#qdock" hx-swap="outerHTML" data-session="${s.id}" data-slash="${JSON.stringify(slash)}" autocomplete="off">
    <input type="hidden" name="key" value=""><input type="hidden" name="delivery" value="steer">
    <div class="cbox">
      <div class="cchips" id="cchips">${activeTab ? ctxChip(t, activeTab) : ""}</div>
      <template id="ctxchip-tpl">${ctxChip(t, { id: "", title: "" })}</template>
      <div class="cin-wrap"><div class="cin-hl" aria-hidden="true"></div><textarea id="cin" name="text" rows="1" placeholder="${t("composer.placeholder", { agent: s.kind === "coordinator" ? t("term.coordinator") : t("composer.agent") })}" aria-label="${t("composer.aria")}"></textarea><div class="slash-pop" role="listbox" hidden></div></div>
      <div class="cbar">
        <button type="button" class="btn" data-variant="ghost" data-size="icon-sm" data-act="attach" aria-label="${t("composer.attach")}" data-tooltip="${t("composer.attachHint")}" data-side="top">${ic("plus")}</button>
        <input type="file" id="cfile" multiple hidden accept="image/*,application/pdf,text/*,.md,.csv,.json">
        ${owner ? modelPicker(cx, cur) : ""}
        ${owner ? html`<span class="eff-wrap" ${effortOn ? "" : "hidden"}><span class="cbar-sep"></span><div class="dropdown-menu" id="eff-${s.id}"><button type="button" id="eff-${s.id}-trigger" class="btn perm eff-btn" data-variant="ghost" data-size="sm" aria-haspopup="menu" aria-controls="eff-${s.id}-menu" aria-expanded="false" data-tooltip="${t("effort.heading")}" data-side="top"><span>${t(`effort.${effort || "auto"}` as never)}</span>${ic("chevDown", "ic-xs")}</button>
          <div id="eff-${s.id}-popover" data-popover aria-hidden="true" data-side="top" data-align="start"><div role="menu" id="eff-${s.id}-menu" aria-labelledby="eff-${s.id}-trigger">
            <div role="group"><div role="heading">${t("effort.heading")}</div>
            ${join(["", ...EFFORTS].map((e) => html`<div role="menuitemradio" aria-checked="${(effort ?? "") === e}" hx-post="/speca/s/${s.id}/effort" hx-vals='${JSON.stringify({ v: e })}' hx-swap="none"><span>${t(`effort.${e || "auto"}` as never)}<br><small class="muted">${t(`effort.${e || "auto"}.hint` as never)}</small></span></div>`))}
            </div></div></div></div></span>` : ""}
        ${owner && s.kind !== "coordinator" && s.kind !== "dev" ? html`<span class="cbar-sep"></span>` : ""}
        ${s.kind !== "coordinator" && s.kind !== "dev" && cx.me.id === s.owner_id ? html`<div class="dropdown-menu" id="perm-${s.id}"><button type="button" id="perm-${s.id}-trigger" class="btn perm" data-variant="ghost" data-size="sm" aria-haspopup="menu" aria-controls="perm-${s.id}-menu" aria-expanded="false">${ic(a[1], "ic-sm")}<span>${t(`autonomy.${a[0]}` as never)}</span>${ic("chevDown", "ic-xs")}</button>
          <div id="perm-${s.id}-popover" data-popover aria-hidden="true" data-side="top" data-align="start"><div role="menu" id="perm-${s.id}-menu" aria-labelledby="perm-${s.id}-trigger">
            <div role="group"><div role="heading">${t("autonomy.heading")}</div>
            ${join(AUTONOMY.filter(([k]) => k !== "full" || cx.app.config.effects.fullAccess || s.autonomy === "full").map(([k, i]) => html`<div role="menuitemradio" aria-checked="${s.autonomy === k}" hx-post="/speca/s/${s.id}/autonomy" hx-vals='${JSON.stringify({ v: k })}' hx-swap="none">${ic(i)}<span>${t(`autonomy.${k}` as never)}<br><small class="muted">${t(`autonomy.${k}.hint` as never)}</small></span></div>`))}
            </div><hr role="separator">
            <div role="menuitemcheckbox" aria-checked="${s.mode === "plan"}" hx-post="/speca/s/${s.id}/mode" hx-vals='${JSON.stringify({ v: s.mode === "plan" ? "work" : "plan" })}' hx-swap="none">${ic("listChecks")}<span>${t("mode.plan")}<br><small class="muted">${t("mode.plan.hint")}</small></span></div>
          </div></div></div>` : ""}
        ${s.mode === "plan" ? html`<span class="pill p2 mode-pill">${t("mode.plan")}</span>` : ""}
        <span class="grow"></span>
        ${cx.code ? branchChip(t, cx.code, s.id) : ""}
        <button class="send" type="submit" id="send" data-busy="${busy}" data-send-label="${t("composer.send")}" data-stop-label="${t("composer.stop")}" aria-label="${busy ? t("composer.stop") : t("composer.send")}">${ic("arrowUp", "i-up")}${ic("square", "i-stop")}</button>
      </div>
    </div>
  </form>`;
}

export { esc };

/** A subagent in its parent's chat: what it does, on which model, how far, what it costs; its confirmations; open / stop. */
export function subagentCard(t: T, v: SubView, parentId: string, approvals: Array<{ id: string; summary: string; preview_hash: string; plugin_id: string | null }>, tz: string): Raw {
  const st = v.result ? v.result.status : v.approvals ? "waiting" : v.status === "running" ? "running" : v.status === "idle" ? "queued" : v.status === "error" ? "error" : "running";
  const live = !v.result;
  const sec = Math.round(v.ms / 1000);
  const time = sec < 60 ? `${sec} s` : `${Math.floor(sec / 60)} min ${sec % 60} s`;
  const kn = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));
  // header: who and on which model (the model always visible, the name shortens), Stop · Open · the task · a status
  // line with the numbers · its confirmations. The state is data-st (an st-* class would recolour the card).
  const tone = st === "running" ? "live" : st === "queued" ? "ok" : st === "error" ? "bad" : st === "waiting" ? "attention" : "off";
  return html`<div class="e static subcard" data-st="${st}" id="sub-${v.id}" hx-get="/speca/sub/${v.id}/card" hx-trigger="dh-live${live ? ", every 3s" : ""}" hx-swap="outerHTML" data-live-topic="sub:${parentId}">
    <div class="sc-h">${ic("bot", "ic-sm")}<b title="${v.name}">${v.name}</b>${k.pill(v.modelLabel, "muted")}
      ${live ? k.button({ icon: "square", variant: "ghost", size: "icon-sm", tooltip: t("sub.stop"), side: "top", attrs: html`hx-post="/speca/s/${v.id}/stop" hx-swap="none"` }) : ""}
      ${k.button({ icon: "appWindow", variant: "ghost", size: "icon-sm", tooltip: t("subb.onCanvas"), side: "top", attrs: html`hx-post="/speca/s/${parentId}/subs/canvas" hx-swap="none"` })}
      ${k.button({ label: t("sub.open"), variant: "outline", size: "sm", href: `/speca/s/${v.id}`, attrs: html`data-sub="${v.id}"` })}</div>
    <div class="sc-task">${v.task}</div>
    <div class="sc-foot">${k.status({ tone, text: t(`sub.st.${st}` as never) })}<span class="sc-meta">${t("sub.steps", { n: v.steps })} · ${t("sub.tokens", { n: kn(v.tokensIn + v.tokensOut) })}${v.cost > 0 ? ` · $${v.cost.toFixed(v.cost < 1 ? 3 : 2)}` : ""} · ${time}</span>${v.mode === "read" ? k.pill(t("sub.read"), "outline") : ""}</div>
    ${approvals.length ? join(approvals.map((a) => html`<form class="sc-appr" hx-post="/speca/approvals/${a.id}" hx-swap="none"><input type="hidden" name="hash" value="${a.preview_hash}">${ic("lock", "ic-xs")}<span class="grow">${a.plugin_id ? html`<b>${a.plugin_id}</b> · ` : ""}${a.summary}</span>
      ${k.button({ label: t("appr.reject"), variant: "outline", size: "sm", type: "submit", attrs: html`name="decision" value="rejected"` })}${k.button({ label: t("appr.do"), size: "sm", type: "submit", attrs: html`name="decision" value="approved"` })}</form>`)) : ""}
  </div>`;
}

/** The live line of a running turn (refreshed every 2 s): what the agent does now and for how long; a warning when
 *  nothing moves; red with Stop when the process stopped sending its heartbeat. */
export function activityLine(t: T, s: SessionRow, canStop: boolean, nudged = false): Raw {
  const a = (s.activity ?? null) as { phase?: string; tool?: string; chars?: number; since?: number } | null;
  const now = Date.now();
  const ru = t.locale === "ru";
  const fmt = (ms: number) => { const sec = Math.max(0, Math.round(ms / 1000)); return sec < 60 ? `${sec} ${ru ? "с" : "s"}` : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`; };
  const tool = (a?.tool ?? "").replace(/^mcp__[^_]+__/, "").replace(/_/g, " ");
  const label = !a?.phase ? t("chat.thinking") : a.phase === "tool_input" ? t("act.tool_input", { tool }) : a.phase === "tool" ? t("act.tool", { tool }) : t(`act.${a.phase}` as never);
  const chars = a?.chars && a.chars > 200 ? ` · ${t("act.chars", { n: a.chars >= 10_000 ? `${Math.round(a.chars / 1000)}${ru ? " тыс." : "k"}` : String(a.chars) })}` : "";
  const elapsed = a?.since ? ` · ${fmt(now - a.since)}` : "";
  const hbAge = s.run_heartbeat_at ? now - new Date(s.run_heartbeat_at).getTime() : 0;
  const quiet = a?.phase && a.phase !== "waiting" && a.phase !== "tool" && s.activity_at ? now - new Date(s.activity_at).getTime() : 0;
  const stop = canStop ? html`<button class="btn" data-variant="outline" data-size="sm" hx-post="/speca/s/${s.id}/stop" hx-swap="none">${ic("square", "ic-xs")}${t("act.stop")}</button>` : "";
  if (s.run_token && hbAge > 40_000) return html`<span class="act-bad">${ic("alert", "ic-sm")}${t("act.dead", { time: fmt(hbAge) })}</span>${stop}`;
  // the step's time is already in the label: repeat the quiet time only when it differs from it
  const sameTime = a?.since ? Math.abs((now - a.since) - quiet) < 5_000 : false;
  // a long silence: said plainly, with a way to ask where it is (a steer message, once until it is delivered)
  const nudge = canStop ? (nudged ? html`<span class="act-note">${t("act.nudged")}</span>` : html`<button class="btn" data-variant="outline" data-size="sm" hx-post="/speca/s/${s.id}/nudge" hx-swap="none">${ic("msg", "ic-xs")}${t("act.nudge")}</button>`) : "";
  if (quiet > 90_000) return html`<i class="spin"></i><span>${label}${chars}${elapsed}</span><span class="act-warn">${a?.phase === "tool_input" ? t("act.quietTool") : sameTime ? t("act.quietSame") : t("act.quiet", { time: fmt(quiet) })}</span>${a?.phase === "tool_input" ? "" : nudge}${stop}`;
  return html`<i class="spin"></i><span class="shimmer">${label}${chars}${elapsed}</span>`;
}
