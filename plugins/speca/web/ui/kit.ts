// The design system as code (docs/DESIGN.md §3): every screen and plugin builds its UI from these functions, so the
// markup — and with it the metrics in product.css "System" — is the same everywhere. Each returns Raw HTML.
// Extra attributes (hx-*, data-*, ids) come in `attrs`, built with html`…` so they stay escaped.
import { html, join, type Raw } from "../html.ts";
import { ic } from "./icons.ts";

type Attrs = { attrs?: Raw };
const A = (a?: Raw) => a ?? html``;
const hiddenInputs = (h?: Record<string, string>) => (h ? join(Object.entries(h).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)) : "");

// ── controls ───────────────────────────────────────────────────────────
export type ButtonOpts = Attrs & {
  label?: string; icon?: string;
  variant?: "primary" | "outline" | "ghost" | "destructive";
  size?: "default" | "sm" | "icon-sm" | "icon-xs";
  /** For icon-only buttons: the tooltip and the accessible name. */
  tooltip?: string; side?: "top" | "bottom" | "left" | "right";
  href?: string; type?: "button" | "submit";
  /** Drawn busy (a spinner, not pressable). Any button becomes busy by itself while what it started runs — a form it
   *  sent, an htmx request (app.js); this is for a state the server already knows. */
  busy?: boolean;
};
export function button(o: ButtonOpts): Raw {
  const iconOnly = !o.label;
  const size = o.size ?? (iconOnly ? "icon-sm" : "default");
  const icSize = size === "icon-xs" ? "ic-xs" : "ic-sm";
  const variant = o.variant && o.variant !== "primary" ? html` data-variant="${o.variant}"` : html``;
  const sz = size !== "default" ? html` data-size="${size}"` : html``;
  const tip = o.tooltip ? html` aria-label="${o.tooltip}" data-tooltip="${o.tooltip}" data-side="${o.side ?? "bottom"}"` : html``;
  const inner = html`${o.icon ? ic(o.icon, icSize) : ""}${o.label ?? ""}`;
  return o.href
    ? html`<a class="btn"${variant}${sz}${tip} href="${o.href}" ${A(o.attrs)}>${inner}</a>`
    : html`<button class="btn" type="${o.type ?? "button"}"${variant}${sz}${tip}${o.busy ? html` aria-busy="true"` : ""} ${A(o.attrs)}>${inner}</button>`;
}

/** One line of text. `autocomplete` defaults to "off"; secrets use "new-password", names and emails their own. */
export function input(o: Attrs & { name: string; value?: string; placeholder?: string; type?: string; required?: boolean; autofocus?: boolean; autocomplete?: string; cls?: string }): Raw {
  return html`<input class="input ${o.cls ?? ""}" name="${o.name}" type="${o.type ?? "text"}" value="${o.value ?? ""}" placeholder="${o.placeholder ?? ""}" autocomplete="${o.autocomplete ?? "off"}" ${o.required ? "required" : ""} ${o.autofocus ? "autofocus" : ""} ${A(o.attrs)}>`;
}
export function textarea(o: Attrs & { name: string; value?: string; placeholder?: string; rows?: number; required?: boolean; autofocus?: boolean }): Raw {
  return html`<textarea class="textarea" name="${o.name}" rows="${o.rows ?? 3}" placeholder="${o.placeholder ?? ""}" ${o.required ? "required" : ""} ${o.autofocus ? "autofocus" : ""} ${A(o.attrs)}>${o.value ?? ""}</textarea>`;
}
export function select(o: Attrs & { name: string; options: Array<[string, string]>; value?: string }): Raw {
  return html`<select class="select" name="${o.name}" ${A(o.attrs)}>${join(o.options.map(([v, l]) => html`<option value="${v}" ${v === o.value ? "selected" : ""}>${l}</option>`))}</select>`;
}
export function checkbox(o: Attrs & { name: string; value: string; label: string; hint?: string; checked?: boolean }): Raw {
  return html`<label class="check-row"><input type="checkbox" class="checkbox" name="${o.name}" value="${o.value}" ${o.checked ? "checked" : ""} ${A(o.attrs)}><span class="row-t"><span class="t">${o.label}</span>${o.hint ? html`<span class="row-m">${o.hint}</span>` : ""}</span></label>`;
}
/** An on/off switch (Basecoat's) with an optional label after it. */
export function toggle(o: Attrs & { name?: string; checked?: boolean; label?: string; aria?: string }): Raw {
  return html`<label class="switch-row"><input type="checkbox" role="switch" class="input" ${o.name ? html`name="${o.name}"` : ""} value="1" aria-label="${o.aria ?? o.label ?? ""}" ${o.checked ? "checked" : ""} ${A(o.attrs)}>${o.label ? html`<span>${o.label}</span>` : ""}</label>`;
}
export { toggle as switch };
/** A one-line form: an input and its button, one height (docs/DESIGN.md — controls side by side match). */
export function inlineForm(o: Attrs & { input: Raw; button: Raw }): Raw {
  return html`<form class="inline-form" ${A(o.attrs)}>${o.input}${o.button}</form>`;
}
/** Controls side by side inside a larger form (a field and its buttons): the same row as inlineForm, not a form. */
export function controlRow(...items: Raw[]): Raw {
  return html`<div class="inline-form">${join(items)}</div>`;
}
/** Segments that are radio inputs: they work inside a form (hx-trigger="change"), the checked one is "on". */
export function segRadio(o: { name: string; items: Array<{ value: string; label: string; checked?: boolean }> }): Raw {
  return html`<div class="seg" role="radiogroup">${join(o.items.map((i) => html`<label><input type="radio" name="${o.name}" value="${i.value}" ${i.checked ? "checked" : ""}><span>${i.label}</span></label>`))}</div>`;
}
/** A labelled control: label, the control, a hint under it. */
export function field(o: { label?: string; hint?: string | Raw; control: Raw; tag?: "label" | "div" }): Raw {
  const inner = html`${o.label ? html`<span class="field-label">${o.label}</span>` : ""}${o.control}${o.hint ? html`<span class="field-hint">${o.hint}</span>` : ""}`;
  return o.tag === "div" ? html`<div class="field">${inner}</div>` : html`<label class="field">${inner}</label>`;
}
export function search(o: Attrs & { name: string; placeholder: string; value?: string; id?: string; autofocus?: boolean }): Raw {
  return html`<label class="search">${ic("search", "ic-sm")}<input class="input" name="${o.name}" value="${o.value ?? ""}" placeholder="${o.placeholder}" ${o.id ? html`id="${o.id}"` : ""} ${o.autofocus ? "autofocus" : ""} autocomplete="off" spellcheck="false" ${A(o.attrs)}></label>`;
}
/** A one-line composer: an input and a round send button in one box (My day's "ask or assign"). */
export function askBar(o: Attrs & { name: string; placeholder: string; sendLabel: string; aria?: string; hidden?: Record<string, string>; cls?: string }): Raw {
  return html`<form class="ask-bar ${o.cls ?? ""}" ${A(o.attrs)}>${input({ name: o.name, placeholder: o.placeholder, attrs: html`aria-label="${o.aria ?? o.placeholder}"` })}${hiddenInputs(o.hidden)}${button({ icon: "arrowUp", size: "icon-sm", type: "submit", tooltip: o.sendLabel })}</form>`;
}
/** Chips, segments and a search on one line that wraps on narrow widths. `form` makes it a form (filters by change). */
export function filterBar(body: Raw, o: Attrs & { form?: boolean } = {}): Raw {
  return o.form ? html`<form class="filter-bar" ${A(o.attrs)}>${body}</form>` : html`<div class="filter-bar" ${A(o.attrs)}>${body}</div>`;
}

// ── structure ──────────────────────────────────────────────────────────
/** A section label; `count` after it, `hint` — a quiet note on the right. */
export function secLabel(text: string, o: { count?: number; hint?: string | Raw } = {}): Raw {
  return html`<div class="sec-label">${text}${o.count !== undefined ? html`<span class="sec-n">${o.count}</span>` : ""}${o.hint ? html`<span class="sec-hint">${o.hint}</span>` : ""}</div>`;
}
/** A section of a canvas page: a label (with a count) and its content, set apart from the one before. */
export function pageSection(o: Attrs & { title?: string; count?: number; hint?: string | Raw; body: Raw }): Raw {
  return html`<section class="page-sect" ${A(o.attrs)}>${o.title ? secLabel(o.title, { count: o.count, hint: o.hint }) : ""}${o.body}</section>`;
}
/** A card: an optional header (icon, title, actions on the right) and content. */
export function panel(o: Attrs & { icon?: string; title?: string; actions?: Raw; body: Raw; cls?: string }): Raw {
  return html`<section class="panel ${o.cls ?? ""}" ${A(o.attrs)}>${o.title ? html`<header class="panel-h">${o.icon ? ic(o.icon, "ic-sm") : ""}<span class="grow">${o.title}</span>${o.actions ?? ""}</header>` : ""}${o.body}</section>`;
}
export function rows(items: Raw[], o: Attrs & { divided?: boolean; cls?: string } = {}): Raw {
  return html`<div class="rows ${o.divided ? "divided" : ""} ${o.cls ?? ""}" ${A(o.attrs)}>${join(items)}</div>`;
}
export type RowOpts = Attrs & {
  icon?: string; lead?: Raw; title: string | Raw; meta?: string | Raw; meta2?: string | Raw; right?: string | Raw;
  actions?: Raw; actionsAlways?: boolean; off?: boolean; current?: boolean;
  tag?: "div" | "a" | "button"; href?: string; type?: "button" | "submit";
};
const rowInner = (o: RowOpts) => html`${o.lead ?? (o.icon ? ic(o.icon, "ic-sm") : "")}<span class="row-t"><span class="t">${o.title}</span>${o.meta ? html`<span class="row-m">${o.meta}</span>` : ""}${o.meta2 ? html`<span class="row-m2">${o.meta2}</span>` : ""}</span>${o.right ? html`<span class="row-m">${o.right}</span>` : ""}${o.actions ? html`<span class="row-tools ${o.actionsAlways ? "always" : ""}">${o.actions}</span>` : ""}`;
/** One row: icon · title + meta under it · something on the right · actions shown on hover. `current` = selected.
 *  As a button it can submit its form (`type: "submit"`, name/value in attrs). */
export function row(o: RowOpts): Raw {
  const inner = rowInner(o);
  const cls = `row-i${o.off ? " off" : ""}`;
  const cur = o.current ? html` aria-current="true"` : html``;
  if (o.tag === "a") return html`<a class="${cls}" href="${o.href ?? "#"}"${cur} ${A(o.attrs)}>${inner}</a>`;
  if (o.tag === "button") return html`<button type="${o.type ?? "button"}" class="${cls}"${cur} ${A(o.attrs)}>${inner}</button>`;
  return html`<div class="${cls}"${cur} ${A(o.attrs)}>${inner}</div>`;
}
/** A row that opens: the row is the summary, `body` shows under it (a question and its answer). */
export function rowDetails(o: RowOpts & { body: Raw; open?: boolean }): Raw {
  return html`<details class="row-d" ${o.open ? "open" : ""} ${A(o.attrs)}><summary class="row-i${o.off ? " off" : ""}">${rowInner({ ...o, attrs: undefined })}${ic("chevDown", "ic-xs row-chev")}</summary><div class="row-d-b">${o.body}</div></details>`;
}
/** Secondary items under a cut: "label · count ›", closed by default. */
export function cut(o: Attrs & { label: string; count?: number; body: Raw; open?: boolean }): Raw {
  return html`<details class="disclose" ${o.open ? "open" : ""} ${A(o.attrs)}><summary>${ic("chevRight", "ic-xs")}${o.label}${o.count !== undefined ? html`<span class="sec-n">${o.count}</span>` : ""}</summary><div class="disclose-b">${o.body}</div></details>`;
}
/** A numbered how-to: steps of a setup guide. `items` — strings / Raw, or Raw `<li>`s from a catalog string. */
export function howto(items: Array<string | Raw> | Raw): Raw {
  return html`<ol class="howto-list">${Array.isArray(items) ? join(items.map((x) => html`<li>${x}</li>`)) : items}</ol>`;
}
/** A grid of media tiles (images, video, audio): preview, a title and one line under it, actions on the right. */
export function tiles(items: Raw[]): Raw {
  return html`<div class="tiles">${join(items)}</div>`;
}
export function tile(o: Attrs & { href: string; img?: string; icon?: string; title: string; meta?: string | Raw; meta2?: string | Raw; actions?: Raw; newTab?: boolean }): Raw {
  return html`<figure class="tile" ${A(o.attrs)}><a class="tile-m" href="${o.href}" ${o.newTab === false ? "" : html`target="_blank" rel="noopener"`}>${o.img ? html`<img src="${o.img}" alt="${o.title}" loading="lazy">` : ic(o.icon ?? "file")}</a>
    <figcaption><span class="row-t"><span class="t" title="${o.title}">${o.title}</span>${o.meta ? html`<span class="row-m2">${o.meta}</span>` : ""}${o.meta2 ? html`<span class="row-m2">${o.meta2}</span>` : ""}</span>${o.actions ? html`<span class="tile-tools">${o.actions}</span>` : ""}</figcaption></figure>`;
}
/** Dashboard figures: a row of big numbers with a word under each (how many work, wait, finished). */
export function kpis(items: Array<{ value: string | number; label: string; tone?: "attention" }>): Raw {
  return html`<div class="dash-kpis">${join(items.map((x) => html`<div class="dash-fig"${x.tone ? html` data-tone="${x.tone}"` : ""}><span class="dash-fig-v">${x.value}</span><span class="dash-fig-l">${x.label}</span></div>`))}</div>`;
}
/** A dashboard card answers three things, in order: what it is (a big title, one line of what it was asked) · what
 *  happens (one sentence led by an icon of its state — working, waiting, done, failed — never a grey label) · how far
 *  (only with a measure: a thin bar of the plan's steps across the card, the percentage small at its end, "n of m"
 *  under it). Then what it needs from the
 *  person (`attention`, k.dashAttn) and one quiet line: details on the left, an action on the right. */
export type DashState = "live" | "wait" | "done" | "off" | "bad";
export type DashNow = { state: DashState; text: string };
/** How far: a percentage and its words; `steps` — the plan's items as segments (done, the one in work, the rest). */
export type DashProgress = { pct: number; label: string; tone?: "live" | "ok" | "off"; steps?: Array<"done" | "doing" | "todo"> };
const DASH_ICON: Record<DashState, string> = { live: "", wait: "clock", done: "check", off: "pause", bad: "alert" };
export function dashCard(o: Attrs & {
  title: string; href?: string; sub?: string; status: { tone: Tone; text: string; meta?: string };
  now?: DashNow; progress?: DashProgress;
  attention?: Raw; meta?: string; actions?: Raw;
}): Raw {
  const p = o.progress;
  return html`<section class="dash-card" ${A(o.attrs)}>
    <header class="dash-h"><div class="dash-t">${o.href ? html`<a class="dash-title" href="${o.href}">${o.title}</a>` : html`<h3 class="dash-title">${o.title}</h3>`}${o.sub ? html`<p class="dash-sub" title="${o.sub}">${o.sub}</p>` : ""}</div>
      <div class="dash-st">${status(o.status)}</div></header>
    ${o.now ? html`<p class="dash-now" data-st="${o.now.state}">${o.now.state === "live" ? html`<i class="spin"></i>` : ic(DASH_ICON[o.now.state], "ic-sm")}<span title="${o.now.text}">${o.now.text}</span></p>` : ""}
    ${p ? html`<div class="dash-prog" data-tone="${p.tone ?? "live"}"><div class="dash-prog-row">${p.steps?.length && p.steps.length <= 16
      ? html`<div class="dash-seg" style="--n:${p.steps.length}">${join(p.steps.map((x) => html`<i data-st="${x}"></i>`))}</div>`
      : html`<div class="prog-bar prog-lg"><i style="width:${p.pct}%"></i></div>`}<b class="dash-pct">${p.pct}%</b></div>
      <span class="dash-prog-l">${p.label}</span></div>` : ""}
    ${o.attention ?? ""}
    ${o.meta || o.actions ? html`<div class="dash-f"><span class="dash-meta">${o.meta ?? ""}</span>${o.actions ?? ""}</div>` : ""}
  </section>`;
}
/** An agent's card: where (its project, or a subagent's name) with its state and time on top; the task (two lines at
 *  most, what it was asked in its tooltip); how far — what it does now and "step n of m" over a thin bar (no plan while
 *  it works: a running stripe; nothing to show: no bar); what it needs from the person, decided right there (`ask`; an
 *  irreversible action — `crit` — in red, with the exact command and that it cannot be undone); a note (its result,
 *  what went wrong, what it said last); a foot: model, tokens, then icon buttons with tooltips (`tools`). */
export type TicketTone = "needs" | "run" | "idle" | "done" | "bad";
export function ticket(o: Attrs & {
  tone: TicketTone; crit?: boolean; where?: { icon: string; text: string }; state: string; time?: string;
  title: string; href?: string; hint?: string;
  /** pct null: it works, how far is unknown (a running stripe) */
  progress?: { text: string; label?: string; pct: number | null } | null;
  ask?: { label: string; text?: string; cmd?: string; risk?: string; actions?: Raw } | null;
  note?: { label: string; text: string; bad?: boolean } | null;
  model?: string; usage?: string; tools?: Raw;
}): Raw {
  const p = o.progress, a = o.ask, n = o.note;
  return html`<section class="tk" data-tone="${o.tone}"${o.crit ? html` data-crit` : ""} ${A(o.attrs)}>
    <div class="tk-top">${o.where ? html`<span class="tk-where" title="${o.where.text}">${ic(o.where.icon, "ic-xs")}<span>${o.where.text}</span></span>` : ""}<span class="tk-gap"></span>
      <span class="tk-st"><i class="tk-dot"></i>${o.state}</span>${o.time ? html`<span class="tk-time">${o.time}</span>` : ""}</div>
    <h3 class="tk-title" title="${o.hint || o.title}">${o.href ? html`<a href="${o.href}">${o.title}</a>` : o.title}</h3>
    ${p ? html`<div class="tk-prog"><div class="tk-prog-row"><span class="tk-now" title="${p.text}">${p.text}</span>${p.label ? html`<span class="tk-plan">${p.label}</span>` : ""}</div>
      <span class="tk-bar"${p.pct === null ? html` data-run` : ""}><i${p.pct === null ? "" : html` style="width:${p.pct}%"`}></i></span></div>` : ""}
    ${a ? html`<div class="tk-ask"><span class="tk-ask-l">${o.crit ? ic("warn", "ic-xs") : ""}${a.label}</span>${a.text ? html`<p class="tk-ask-t" title="${a.text}">${a.text}</p>` : ""}
      ${a.cmd ? html`<p class="tk-cmd" title="${a.cmd}">${a.cmd}</p>` : ""}${a.risk ? html`<p class="tk-risk">${a.risk}</p>` : ""}
      ${a.actions ? html`<div class="tk-ask-acts">${a.actions}</div>` : ""}</div>` : ""}
    ${n ? html`<p class="tk-note"${n.bad ? html` data-bad` : ""} title="${n.text}"><b>${n.label}:</b> ${n.text}</p>` : ""}
    <footer class="tk-f">${o.model ? html`<span class="tk-model">${o.model}</span>` : ""}${o.usage ? html`<span class="tk-use">${o.usage}</span>` : ""}<span class="tk-gap"></span>
      <span class="tk-acts">${o.tools ?? ""}</span></footer>
  </section>`;
}
/** Meters: how much of a limit is used — its name with the percentage at the end of the line, a thin bar across, a
 *  quiet line under it (when it resets); `bad` — near the limit. */
export function meters(items: Array<{ label: string; pct: number; sub?: string; tone?: "bad" }>): Raw {
  return html`<div class="meters">${join(items.map((m) => html`<div class="meter-r"${m.tone ? html` data-tone="${m.tone}"` : ""}><div class="meter-h"><span>${m.label}</span><b>${m.pct}%</b></div><div class="prog-bar prog-lg"><i style="width:${m.pct}%"></i></div>${m.sub ? html`<small>${m.sub}</small>` : ""}</div>`))}</div>`;
}
/** A dashboard with nothing to show: a quiet centred block — an icon, a title, one line of what will appear here. */
export function dashEmpty(o: { icon: string; title: string; text: string }): Raw {
  return html`<div class="dash-empty">${iconTile(o.icon, 44)}<b>${o.title}</b><span>${o.text}</span></div>`;
}
/** What waits for the person, one line each that leads there: what (bold), its kind and where under it, an arrow.
 *  In a dashboard card (what that agent needs) and in the dashboard's side column (all of it). */
export function dashAttn(items: Array<{ icon: string; text: string; meta?: string; href: string }>): Raw {
  return html`<div class="dash-attn">${join(items.map((x) => html`<a class="dash-attn-i" href="${x.href}">${ic(x.icon, "ic-sm")}<span class="dash-attn-t"><b title="${x.text}">${x.text}</b>${x.meta ? html`<small>${x.meta}</small>` : ""}</span>${ic("chevRight", "ic-xs dash-attn-go")}</a>`))}</div>`;
}
/** A rounded square with an icon (plugins, connections): 32 in rows, 44 in a head. */
export function iconTile(icon: string, size: 32 | 44 = 32): Raw {
  return html`<span class="icon-tile ${size === 44 ? "icon-tile-lg" : ""}">${ic(icon, size === 44 ? "" : "ic-sm")}</span>`;
}
/** Radio cards: icon, title and a hint each; the checked one is outlined (kinds of a new project). */
export function choiceCards(o: Attrs & { name: string; items: Array<{ value: string; icon?: string; label: string; hint?: string; checked?: boolean }> }): Raw {
  return html`<div class="choice-cards" role="radiogroup" ${A(o.attrs)}>${join(o.items.map((i) => html`<label class="choice-card"><input type="radio" name="${o.name}" value="${i.value}" ${i.checked ? "checked" : ""}>${i.icon ? ic(i.icon, "ic-sm") : ""}<b>${i.label}</b>${i.hint ? html`<small>${i.hint}</small>` : ""}</label>`))}</div>`;
}
/** The head of a canvas page (My day, Connections, Artifacts…): title, one line, actions on the right. */
export function pageHead(o: { title: string; sub?: string; actions?: Raw }): Raw {
  return html`<header class="page-h"><div><h2>${o.title}</h2>${o.sub ? html`<p>${o.sub}</p>` : ""}</div>${o.actions ?? ""}</header>`;
}

// ── dialog ─────────────────────────────────────────────────────────────
const closeBtn = (label: string) => button({ icon: "x", variant: "ghost", size: "icon-sm", tooltip: label, attrs: html`data-act="close-dialog"` });
/** Header (title + one line) → body → footer (secondary left, main right). `form` makes the body a form; `scroll`
 *  lets a long body scroll while the header and footer stay. Focus goes to the first field (app.js), not to ✕. */
export function dialog(o: {
  size?: "sm" | "md" | "lg" | "xl"; icon?: string; title: string; sub?: string; closeLabel: string;
  body: Raw; footLeft?: Raw; footRight?: Raw; form?: Raw; cls?: string; headExtra?: Raw; scroll?: boolean;
}): Raw {
  const head = html`<header class="dlg-h"><div><h2>${o.icon ? ic(o.icon, "ic-sm") : ""}${o.title}</h2>${o.sub ? html`<p>${o.sub}</p>` : ""}</div>${o.headExtra ?? ""}${closeBtn(o.closeLabel)}</header>`;
  const foot = o.footLeft || o.footRight ? html`<footer class="dlg-foot">${o.footLeft ?? ""}<span class="grow"></span>${o.footRight ?? ""}</footer>` : "";
  const size = o.size && o.size !== "sm" ? `dlg-${o.size}` : "";
  const body = o.scroll ? html`<div class="dlg-scroll">${o.body}</div>` : o.body;
  return o.form
    ? html`<div class="dlg-form ${size} ${o.cls ?? ""}">${head}<form class="dlg-body" ${o.form}>${body}${foot}</form></div>`
    : html`<div class="dlg-form ${size} ${o.cls ?? ""}">${head}<div class="dlg-body">${body}</div>${foot}</div>`;
}
/** A full-height dialog: a header band, then a list (320) and a detail, each scrolling on its own (Plugins). */
export function splitDialog(o: { icon?: string; title: string; sub?: string; closeLabel: string; headExtra?: Raw; list: Raw; detail: Raw; detailId?: string }): Raw {
  return html`<div class="dlg-split"><header class="dlg-h"><div><h2>${o.icon ? ic(o.icon, "ic-sm") : ""}${o.title}</h2>${o.sub ? html`<p>${o.sub}</p>` : ""}</div>${o.headExtra ?? ""}${closeBtn(o.closeLabel)}</header>
    <div class="dlg-split-b"><div class="dlg-split-list">${o.list}</div><div class="dlg-split-detail" ${o.detailId ? html`id="${o.detailId}"` : ""}>${o.detail}</div></div></div>`;
}

// ── small parts ────────────────────────────────────────────────────────
export function seg(items: Array<{ label: string; on: boolean; attrs?: Raw; href?: string }>): Raw {
  return html`<div class="seg" role="tablist">${join(items.map((i) => i.href
    ? html`<a href="${i.href}" aria-current="${i.on}" ${A(i.attrs)}>${i.label}</a>`
    : html`<button type="button" aria-pressed="${i.on}" ${A(i.attrs)}>${i.label}</button>`))}</div>`;
}
export function fchip(o: Attrs & { label: string; icon?: string; count?: number; on?: boolean; href?: string }): Raw {
  const inner = html`${o.icon ? ic(o.icon, "ic-xs") : ""}${o.label}${o.count !== undefined ? html`<span class="fchip-n">${o.count}</span>` : ""}`;
  return o.href ? html`<a class="fchip" href="${o.href}" aria-current="${!!o.on}" ${A(o.attrs)}>${inner}</a>` : html`<button type="button" class="fchip" aria-pressed="${!!o.on}" ${A(o.attrs)}>${inner}</button>`;
}
/** A status tag; no tone = muted. */
export function pill(text: string, tone?: "bad" | "outline" | "muted"): Raw {
  return html`<span class="pill ${tone === "bad" ? "p1" : tone === "outline" ? "p2" : "p3"}">${text}</span>`;
}
export type Tone = "ok" | "bad" | "draft" | "off" | "live" | "attention";
/** live — running (pulses); attention — waits for a person (a dark dot); off — an empty ring. */
export function dot(tone?: Tone): Raw {
  return html`<i class="sdot ${tone === "live" ? "pulse" : tone ?? ""}"></i>`;
}
/** A status: a dot and a short word ("● Connected · 3 h"). */
export function status(o: { tone?: Tone; text: string; meta?: string }): Raw {
  return html`<span class="status">${dot(o.tone)}${o.text}${o.meta ? html`<span class="status-m">· ${o.meta}</span>` : ""}</span>`;
}
export function empty(o: { icon: string; title?: string; text: string; action?: Raw }): Raw {
  return html`<div class="empty">${ic(o.icon)}${o.title ? html`<h3>${o.title}</h3>` : ""}<span>${o.text}</span>${o.action ?? ""}</div>`;
}
export function emptyLine(text: string): Raw {
  return html`<div class="empty-line">${text}</div>`;
}
/** A line on --sunk (old version, read-only, a decided approval); tone "bad" for errors. `oneLine` truncates the
 *  text (the full one goes to `title`). */
export function banner(o: Attrs & { icon?: string; text: string | Raw; actions?: Raw; tone?: "bad"; id?: string; title?: string; cls?: string; oneLine?: boolean }): Raw {
  return html`<div class="banner ${o.tone ?? ""} ${o.oneLine ? "one" : ""} ${o.cls ?? ""}" ${o.id ? html`id="${o.id}"` : ""} ${o.title ? html`title="${o.title}"` : ""} ${o.tone === "bad" ? html`role="alert"` : ""} ${A(o.attrs)}>${o.icon ? ic(o.icon, "ic-sm") : ""}<span class="grow">${o.text}</span>${o.actions ?? ""}</div>`;
}
/** A small text button with ⌄ that opens a panel — how secondary functions hide in a title line. */
export function chipTrigger(o: Attrs & { label: string | Raw; lead?: Raw }): Raw {
  return html`<button type="button" class="chip-trigger" ${A(o.attrs)}>${o.lead ?? ""}${o.label}${ic("chevDown", "ic-xs")}</button>`;
}
export function menu(o: Attrs & { heading?: string; items: Raw[] }): Raw {
  return html`<div class="menu" role="menu" ${A(o.attrs)}>${o.heading ? html`<div class="menu-h">${o.heading}</div>` : ""}${join(o.items)}</div>`;
}
export function menuItem(o: Attrs & { icon?: string; label: string; sub?: string; shortcut?: string; checked?: boolean }): Raw {
  return html`<button type="button" class="menu-i" role="menuitem" ${A(o.attrs)}>${o.checked ? ic("check", "ic-sm") : o.icon ? ic(o.icon, "ic-sm") : ""}<span class="grow">${o.label}${o.sub ? html`<small>${o.sub}</small>` : ""}</span>${o.shortcut ? html`<span class="menu-k">${o.shortcut}</span>` : ""}</button>`;
}

// ── settings and pages ─────────────────────────────────────────────────
/** The head of a settings page (or of a detail pane): optional tile, title, a status line, one line, actions. */
export function setHead(o: { title: string; sub?: string; actions?: Raw; lead?: Raw; meta?: Raw }): Raw {
  return html`<header class="set-head">${o.lead ?? ""}<div><h2>${o.title}</h2>${o.meta ?? ""}${o.sub ? html`<p>${o.sub}</p>` : ""}</div>${o.actions ?? ""}</header>`;
}
/** The footer of a page or a card page: a hint on the left, actions on the right (secondary before the main one). */
export function pageFoot(o: { hint?: string | Raw; actions: Raw }): Raw {
  return html`<footer class="page-foot">${o.hint ? html`<span class="field-hint">${o.hint}</span>` : ""}<span class="grow"></span>${o.actions}</footer>`;
}
/** The quiet step line of a wizard; `href` makes the steps links (welcome lets people jump). */
export function steps(items: Array<{ key: string; label: string; href?: string }>, cur: string): Raw {
  const i = items.findIndex((s) => s.key === cur);
  return html`<ol class="step-line">${join(items.map((s, j) => {
    const inner = html`${j < i ? ic("check", "ic-xs") : html`<span class="step-n">${j + 1}</span>`}${s.label}`;
    return html`<li class="${j < i ? "done" : j === i ? "cur" : ""}" ${j === i ? html`aria-current="step"` : ""}>${s.href ? html`<a href="${s.href}">${inner}</a>` : inner}</li>`;
  }))}</ol>`;
}
/** A page of its own on a plain background (sign-in, join, setup and welcome steps): steps · head · a stack of
 *  sections · footer. 440 wide, `wide` 780. With `form` the whole card is one form (hidden fields included). */
export function pageCard(o: { steps?: Raw; title: string; sub?: string; body: Raw; actions?: Raw; hint?: string | Raw; form?: Raw; hidden?: Record<string, string>; wide?: boolean }): Raw {
  const inner = html`${hiddenInputs(o.hidden)}${o.steps ?? ""}${setHead({ title: o.title, sub: o.sub })}<div class="set-stack">${o.body}</div>${o.actions ? pageFoot({ hint: o.hint, actions: o.actions }) : ""}`;
  const cls = `page-card${o.wide ? " wide" : ""}`;
  return o.form ? html`<form class="${cls}" ${o.form}>${inner}</form>` : html`<div class="${cls}">${inner}</div>`;
}
/** A section of a page: header (title, one line of hint, actions) → body → optional footer strip (hint left, action
 *  right). With `form` it is a form (hidden fields included) whose own submit sits in the footer. */
export function section(o: {
  icon?: string; title: string; hint?: string | Raw; actions?: Raw; body?: Raw;
  footHint?: string | Raw; foot?: Raw; form?: Raw; hidden?: Record<string, string>; cls?: string; id?: string;
}): Raw {
  const head = html`<header class="sect-h"><div class="sect-t">${o.icon ? ic(o.icon, "ic-sm") : ""}<h3>${o.title}</h3>${o.actions ? html`<span class="grow"></span>${o.actions}` : ""}</div>${o.hint ? html`<p class="sect-hint">${o.hint}</p>` : ""}</header>`;
  const foot = o.foot ? html`<footer class="sect-f">${o.footHint ? html`<span class="field-hint">${o.footHint}</span>` : ""}<span class="grow"></span>${o.foot}</footer>` : "";
  const body = o.body ? html`<div class="sect-b">${o.body}</div>` : "";
  const id = o.id ? html` id="${o.id}"` : html``;
  return o.form
    ? html`<form class="sect ${o.cls ?? ""}"${id} ${o.form}>${hiddenInputs(o.hidden)}${head}${body}${foot}</form>`
    : html`<section class="sect ${o.cls ?? ""}"${id}>${head}${body}${foot}</section>`;
}
/** Options with a label and a hint: checkboxes or radios, one per row. */
export function choices(o: { name: string; type?: "checkbox" | "radio"; items: Array<{ value: string; label: string | Raw; hint?: string; checked?: boolean }> }): Raw {
  return html`<div class="choices">${join(o.items.map((i) => html`<label class="check-row"><input type="${o.type ?? "checkbox"}" class="${o.type === "radio" ? "radio" : "checkbox"}" name="${o.name}" value="${i.value}" ${i.checked ? "checked" : ""}><span class="row-t"><span class="t">${i.label}</span>${i.hint ? html`<span class="row-m">${i.hint}</span>` : ""}</span></label>`))}</div>`;
}
/** A group of options under one label and hint (a fieldset). */
export function fieldGroup(o: { label: string; hint?: string; body: Raw }): Raw {
  return html`<fieldset class="fgroup"><legend class="field-label">${o.label}</legend>${o.hint ? html`<span class="field-hint">${o.hint}</span>` : ""}${o.body}</fieldset>`;
}
/** Two fields side by side (one column on narrow screens). */
export function fieldRow(...fields: Raw[]): Raw {
  return html`<div class="field-row">${join(fields)}</div>`;
}
export function table(o: { cols: Array<{ label: string; num?: boolean }>; rows: Array<Array<string | Raw>>; cls?: string }): Raw {
  return html`<div class="tbl ${o.cls ?? ""}"><table><thead><tr>${join(o.cols.map((c) => html`<th class="${c.num ? "num" : ""}">${c.label}</th>`))}</tr></thead>
    <tbody>${join(o.rows.map((r) => html`<tr>${join(r.map((cell, i) => html`<td class="${o.cols[i]?.num ? "num" : ""}">${cell}</td>`))}</tr>`))}</tbody></table></div>`;
}
export function stats(items: Array<{ label: string; value: string | number }>): Raw {
  return html`<div class="stats">${join(items.map((s) => html`<div class="stat"><span>${s.label}</span><b>${s.value}</b></div>`))}</div>`;
}
/** A read-only value with a copy button (links, tokens shown once); a click selects the whole value. */
export function copyField(o: Attrs & { value: string; copyLabel: string }): Raw {
  return controlRow(html`<input class="input" readonly value="${o.value}" data-act="select-all" ${A(o.attrs)}>`, button({ icon: "copy", variant: "outline", tooltip: o.copyLabel, attrs: html`data-act="copy" data-v="${o.value}"` }));
}
