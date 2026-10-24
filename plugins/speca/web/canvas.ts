// The canvas beside the chat, Speca's way: a tab strip (rename, close, "+", all tabs, view menu) and the active tab's body.
// Tabs are Hyper's canvas items (canvas.list / canvas.update / canvas.close); a kind's body is drawn by its own
// `$canvas_<kind>.ts`. Hyper's kinds style themselves with Hyper's stylesheet, so their body runs in a frame page
// (/speca/s/:id/tab/:tab/frame) that carries Hyper's CSS and canvas script; Speca's kinds draw in place.
import { html, join, raw, type Raw } from "./html.ts";
import { ic } from "./ui/icons.ts";
import { getSession, type HSession } from "./hyper.ts";
import type { Ctx } from "./route.ts";
import * as k from "./ui/kit.ts";
import { clock, rel } from "./fmt.ts";
import { lineDiff, hunks, stats, canvasText } from "./diff.ts";
import { compareHtml } from "./design/kind.ts";

export type Tab = { id: number; agentId: string; kind: string; title: string; args: Record<string, any>; state: Record<string, any>; active: boolean; createdAt: number; updatedAt: number; closedAt: number | null; version?: number; draftEdits?: number };

/** Kinds Speca draws itself (in the page, with Speca's styles); the rest are Hyper's and go into a frame. */
export const SPECA_KINDS = new Set<string>(["speca.doc", "speca.table", "speca.chart", "speca.metrics", "speca.list", "speca.board", "speca.compare", "speca.design", "speca.changes", "speca.files", "speca.file", "speca.subagents", "speca.timeline"]);

const kindsOf = (c: Ctx): Record<string, { icon?: string; render: Function }> => (c.h.state as any).canvas?.kinds ?? {};
/** Speca's own icons for the kinds it has (its kit and Hyper's html page); Hyper's other kinds keep their Phosphor icon. */
const KIND_ICONS: Record<string, string> = { "speca.doc": "fileText", "speca.table": "table", "speca.chart": "activity", "speca.metrics": "gauge", "speca.list": "listChecks", "speca.board": "layout", "speca.compare": "grid", "speca.design": "penTool", "speca.changes": "fileDiff", "speca.files": "folderTree", "speca.file": "file", "speca.subagents": "bot", "speca.timeline": "clock", html: "appWindow" };
const tabIcon = (c: Ctx, kind: string) => ic(KIND_ICONS[kind] ?? `ph:${kindsOf(c)[kind]?.icon ?? "app-window"}`, "ic-sm tico");

/** The chat a tab belongs to (the person's own), for the tab's own actions (/speca/canvas/:tab/…). */
export async function chatOfTab(c: Ctx, tabId: number): Promise<HSession> {
  const rows = (await c.h.fns.procs.db.select({ sql: "SELECT agent_id FROM canvas_items WHERE id = ?", params: [tabId] })) as Array<{ agent_id: string }>;
  const s = rows[0] ? await getSession(c.h, c.user.id, rows[0].agent_id) : null;
  if (!s) throw new Error(c.t("common.notFound"));
  return s;
}

export async function tabsOf(c: Ctx, sid: string): Promise<Tab[]> {
  return (await c.h.fns.canvas.list({ agentId: sid }).catch(() => [])) as Tab[];
}

export async function canvasHtml(c: Ctx, s: HSession): Promise<Raw> {
  const t = c.t;
  const tabs = await tabsOf(c, s.id);
  const active = tabs.find((x) => x.active) ?? tabs[tabs.length - 1] ?? null;
  const cm = JSON.stringify({ rename: t("canvas.tabRename"), close: t("canvas.tabClose"), others: t("canvas.closeOthers"), all: t("canvas.closeAll") }).replace(/'/g, "&#39;");
  const strip = html`<div class="tabstrip" role="tablist" id="tabs" data-session="${s.id}"${raw(` data-cm='${cm}'`)}>
    ${join(tabs.map((tab) => html`<div class="tab" role="tab" tabindex="${tab.id === active?.id ? 0 : -1}" aria-selected="${tab.id === active?.id}" data-tab="${tab.id}" data-kind="${tab.kind}" data-sub="${tab.kind}" hx-post="/speca/canvas/${tab.id}/activate" hx-vals='${JSON.stringify({ session: s.id })}' hx-swap="none" data-tooltip="${tab.title} · ${tab.kind}" data-tooltip-cut=".tl" data-side="bottom" data-rename="${t("canvas.renameTab")}">
      ${tabIcon(c, tab.kind)}<span class="tl">${tab.title}</span><button class="tx" hx-post="/speca/canvas/${tab.id}/close" hx-vals='${JSON.stringify({ session: s.id })}' hx-swap="none" aria-label="${t("canvas.closeTab", { title: tab.title })}">${ic("x", "ic-xs")}</button></div>`))}
  </div>`;
  const closed = (await c.h.fns.canvas.list({ agentId: s.id, closed: true, limit: 15 }).catch(() => [])) as Tab[];
  const plus = html`<div class="dropdown-menu" id="cplus"><button type="button" id="cplus-trigger" class="btn" data-variant="ghost" data-size="icon-sm" aria-haspopup="menu" aria-controls="cplus-menu" aria-expanded="false" aria-label="${t("canvas.newTab")}" data-tooltip="${t("canvas.newTab")}" data-side="bottom">${ic("plus")}</button>
    <div id="cplus-popover" data-popover aria-hidden="true" data-side="bottom" data-align="end"><div role="menu" id="cplus-menu" aria-labelledby="cplus-trigger">
      ${closed.length ? html`<div role="group"><div role="heading">${t("canvas.recentlyClosed")}</div>${join(closed.map((p) => html`<div role="menuitem" hx-post="/speca/canvas/${p.id}/reopen" hx-vals='${JSON.stringify({ session: s.id })}' hx-swap="none">${tabIcon(c, p.kind)}${p.title}<span data-shortcut>${p.kind}</span></div>`))}</div>` : html`<div role="menuitem" aria-disabled="true">${t("canvas.noSystems")}</div>`}
    </div></div></div>`;
  const tabsBtn = tabs.length > 1 ? html`<button class="btn" data-variant="ghost" data-size="icon-sm" data-act="tabs-menu" aria-label="${t("canvas.allTabs")}" data-tooltip="${t("canvas.allTabs")}" data-side="bottom" data-ph="${t("canvas.searchTabs")}" data-none="${t("canvas.noTabsFound")}" data-close="${t("common.close")}" data-qicon="${String(ic("search", "ic-sm"))}" data-xicon="${String(ic("x", "ic-xs"))}">${ic("chevDown")}</button>` : "";
  const chatBtn = html`<button class="btn" data-variant="ghost" data-size="icon-sm" data-act="chat-pop" aria-pressed="false" aria-label="${t("view.chatPop")}" data-tooltip="${t("view.chatPop")} · ⌘J" data-side="bottom">${ic("chatDots")}<i class="cp-mark" aria-hidden="true"></i></button>`;
  const bar = html`<div class="tabbar">${strip}<div class="tabbar-end">${tabsBtn}${plus}${chatBtn}
    <button class="btn" data-variant="ghost" data-size="icon-sm" data-act="view-menu" aria-label="${t("view.title")}" data-tooltip="${t("view.title")}" data-side="bottom">${ic("layout")}</button></div></div>`;
  const body = active ? await tabBody(c, s, active)
    : html`<div class="empty-canvas" style="--a:var(--signal)"><span class="big">${ic("appWindow")}</span><h3>${t("canvas.emptyTitle")}</h3><p>${t("canvas.emptyHint")}</p></div>`;
  return html`<div class="canvas-in" id="canvas-in" hx-get="/speca/s/${s.id}/canvas" hx-trigger="dh-live" hx-swap="outerHTML" data-live-topic="canvas:${s.id}">${bar}<div class="cbody" id="cbody" role="tabpanel">${body}</div></div>`;
}

type Version = { v: number; name: string | null; author: string; createdAt: number; changes: Array<{ note: string | null; author: string; at: number }> };
type Edit = { n: number; author: string; note: string | null; at: number };
export type BodyOpts = { v?: number; compare?: boolean; at?: number; readonly?: boolean; edit?: boolean };

/** Kinds whose content is an address, not something written: no draft, no versions (a page's live state is not
 *  its content: an html tab keeps versions of its html). */
const versioned = (_c: Ctx, tab: Tab) => !["view", "url", "file", ...BARE_KINDS].includes(tab.kind);
/** Speca's bare tabs: a live view of something outside the canvas (the project's files, its changes) fills the panel —
 *  no title line, no versions, no comments. */
const BARE_KINDS = ["speca.changes", "speca.files", "speca.file", "speca.subagents", "speca.timeline"];

function commentStrings(t: Ctx["t"]): string {
  const keys = ["title", "q", "hint", "ph", "toAgent", "post", "reply", "replyPh", "resolve", "reopen", "showResolved", "remove", "sendNow", "sent", "add", "addHint", "sendAll", "sentAll", "unsent", "clearAll", "clearAsk", "list", "listEmpty", "pick", "selectAll", "unselect", "removeN", "removeAsk", "removedN", "sentMark", "resolvedMark", "page", "justNow", "minAgo", "hAgo", "you", "agent",
    "k.text", "k.heading", "k.cell", "k.row", "k.table", "k.item", "k.list", "k.link", "k.button", "k.image", "k.code", "k.block", "k.field"] as const;
  const o = Object.fromEntries(keys.map((k) => [k, t(`cm.${k}` as never)]));
  return JSON.stringify(o).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** What the kind draws for a tab holding `held` (the draft, a version or a moment of the draft). */
async function drawn(c: Ctx, s: HSession, tab: Tab, held: Tab, q: string): Promise<Raw> {
  const kind = kindsOf(c)[tab.kind];
  if (!kind) return html`<div class="empty-canvas small">${ic("puzzle")}<p>${c.t("canvas.unknownKind", { kind: tab.kind })}</p></div>`;
  if (SPECA_KINDS.has(tab.kind)) {
    try { return raw(String(await kind.render(c.h, { agentId: s.id, item: held, ui: c }))); }
    catch (e: any) { return html`<div class="errcard">${ic("alert", "ic-sm")}${String(e?.message ?? e)}</div>`; }
  }
  // the frame is keyed by the tab's last change, so a new state reloads it and an unchanged one stays put
  return html`<iframe class="sandbox-frame hyper-frame" title="${tab.title}" src="/speca/s/${s.id}/tab/${tab.id}/frame?v=${tab.updatedAt}${raw(q)}"></iframe>`;
}

/** The active tab: its title line (comments, the version chip), a banner when an older version or a moment of the
 *  draft is shown, the content — or two of them compared — and the history drawer (draft, versions, journal). */
export async function tabBody(c: Ctx, s: HSession, tab: Tab, opts: BodyOpts = {}): Promise<Raw> {
  const t = c.t;
  const vd = versioned(c, tab);
  if (!vd) return html`<div class="tab-bare${BARE_KINDS.includes(tab.kind) ? " tab-full" : ""}">${await drawn(c, s, tab, tab, "")}</div>`;
  const vs: Version[] = [...(await c.h.fns.canvas.versions({ itemId: tab.id }))].reverse();
  const journal: { edits: Edit[] } = await c.h.fns.canvas.draft({ itemId: tab.id });
  const edits = journal.edits;
  const draft = edits.length > 0;
  const cur = opts.v ? vs.find((v) => v.v === opts.v) ?? null : null;
  const atEdit = !cur && opts.at ? edits.find((e) => e.n === opts.at) ?? null : null;
  const last = vs[vs.length - 1];
  const onDraft = !cur && draft;
  const shown = cur ?? last;
  const bodyOf = async (v: number | null) => v == null ? { title: tab.title, args: tab.args, state: tab.state } : await c.h.fns.canvas.version({ itemId: tab.id, v });
  const held = cur ? { ...tab, ...(await bodyOf(cur.v)), shown: { v: cur.v } } : atEdit ? { ...tab, ...(await c.h.fns.canvas.version({ itemId: tab.id, edit: atEdit.n })), shown: { edit: atEdit.n } } : tab;
  let content: Raw = await drawn(c, s, tab, held, cur ? `&ver=${cur.v}` : atEdit ? `&at=${atEdit.n}` : "");
  if (opts.compare) {
    const prevOf = (v: number) => [...vs].reverse().find((x) => x.v < v);
    const pair = onDraft && last ? { a: last.v, b: null as number | null, from: `v${last.v}`, to: t("canvas.draft") }
      : shown && prevOf(shown.v) ? { a: prevOf(shown.v)!.v, b: shown.v as number | null, from: `v${prevOf(shown.v)!.v}`, to: `v${shown.v}` } : null;
    if (pair && tab.kind === "speca.design") content = await compareHtml((await bodyOf(pair.a)).args as any, (await bodyOf(pair.b)).args as any, { tabId: tab.id, from: pair.from, to: pair.to, fromV: pair.a, toV: pair.b, locale: t.locale });
    else if (pair) content = diffView(tab.kind, (await bodyOf(pair.a)).args, (await bodyOf(pair.b)).args, t, { tabId: tab.id, from: pair.from, to: pair.to, readonly: !!opts.readonly });
  }
  if (opts.edit && tab.kind === "speca.doc" && !opts.readonly) {
    content = html`<form class="doc-edit" hx-post="/speca/canvas/${tab.id}/edit" hx-swap="none"><textarea name="markdown" class="input doc-ta" rows="24" aria-label="${t("canvas.edit")}">${String(tab.args.markdown ?? "")}</textarea><div class="sec-acts"><button class="btn" data-variant="ghost" data-size="sm" type="button" hx-get="/speca/canvas/${tab.id}/body" hx-target="#cbody" hx-swap="innerHTML">${t("common.cancel")}</button><button class="btn" data-size="sm">${t("common.save")}</button></div></form>`;
  }
  const noteOf = (n: string | null) => (!n ? null : /^restored v\d+$/.test(n) ? t("canvas.restoredFrom", { v: n.slice(10) }) : n);
  const who = (a: string) => (a === "agent" ? t("canvas.byAgent") : a === `user:${c.user.id}` || a === "user" ? t("canvas.byYou") : a.replace(/^user:/, ""));
  const when = (ms: number) => rel(new Date(ms), t.locale);
  const lastEdit = edits[edits.length - 1];
  const body = (q = "") => `/speca/canvas/${tab.id}/body${q}`;
  const look = (q: string, inner: Raw, cls = "vd-b") => html`<button type="button" class="${cls}" hx-get="${body(q)}" hx-target="#cbody" hx-swap="innerHTML">${inner}</button>`;
  const vdRow = (v: Version) => {
    const on = !onDraft && shown && v.v === shown.v;
    const prev = vs.some((x) => x.v < v.v);
    return html`<li class="vd-i${on ? " on" : ""}" data-named="${!!v.name}"><span class="vd-dot" aria-hidden="true"></span>
      ${look(`?v=${v.v}`, html`<b>v${v.v}${v.name ? ` · ${v.name}` : ""}</b><small>${when(v.createdAt)} · ${who(v.author)}</small>`)}
      <span class="vd-acts">${prev ? html`<button type="button" class="btn" data-variant="outline" data-size="sm" hx-get="${body(`?v=${v.v}&compare=1`)}" hx-target="#cbody" hx-swap="innerHTML">${t("canvas.compare")}</button>` : ""}${!opts.readonly && (v.v !== last?.v || draft) ? html`<button type="button" class="btn" data-variant="outline" data-size="sm" hx-post="/speca/canvas/${tab.id}/restore" hx-vals='${JSON.stringify({ v: v.v })}' hx-swap="none">${t("canvas.restore")}</button>` : ""}</span></li>`;
  };
  const drawer = shown ? html`<aside class="ver-drawer" id="verdrawer" hidden aria-label="${t("canvas.history")}">
      <header class="vd-h"><div class="vd-t"><b>${t("canvas.history")}</b><span>${tab.title}</span></div>${k.button({ icon: "x", variant: "ghost", size: "icon-sm", tooltip: t("common.close"), side: "left", attrs: html`data-act="ver-drawer"` })}</header>
      ${draft && !opts.readonly ? html`<div class="vd-save">${k.button({ label: t("canvas.saveAs", { v: (last?.v ?? 0) + 1 }), icon: "check", size: "sm", attrs: html`hx-post="/speca/canvas/${tab.id}/commit" hx-swap="none"` })}${k.button({ icon: "undo", variant: "ghost", size: "icon-sm", tooltip: t("canvas.undo"), side: "bottom", attrs: html`hx-post="/speca/canvas/${tab.id}/undo" hx-swap="none"` })}</div>` : ""}
      <ol class="vd-list">
        ${draft ? html`<li class="vd-i draft${onDraft ? " on" : ""}"><span class="vd-dot" aria-hidden="true"></span>
          ${look("", html`<b>${t("canvas.draft")} · ${t("canvas.edits", { n: edits.length })}</b><small>${[t("canvas.now"), lastEdit ? who(lastEdit.author) : ""].filter(Boolean).join(" · ")}</small>`)}
          <span class="vd-acts">${last ? html`<button type="button" class="btn" data-variant="outline" data-size="sm" hx-get="${body("?compare=1")}" hx-target="#cbody" hx-swap="innerHTML">${t("canvas.compare")}</button>` : ""}</span></li>` : ""}
        ${join([...vs].reverse().map(vdRow))}
      </ol>
      <footer class="vd-f"><button type="button" class="linkbtn" data-dialog="/speca/canvas/${tab.id}/journal">${ic("logs", "ic-sm")}${t("canvas.journalFull")}</button></footer>
    </aside>` : "";
  const verBar = shown ? html`<button type="button" class="vp-chip ${onDraft ? "draft" : ""}" data-act="ver-drawer" aria-expanded="false" aria-controls="verdrawer" data-tooltip="${t("canvas.history")}" data-side="bottom">${onDraft ? html`<i class="draft-dot"></i>${t("canvas.draft")} · ${t("canvas.edits", { n: edits.length })}` : html`v${shown.v}`}${ic("chevDown", "ic-xs")}</button>` : "";
  const cmpBar = opts.compare ? html`<div class="ver-banner slim">${ic("merge", "ic-sm")}<span class="grow">${t("canvas.comparing")}</span><button class="btn" data-variant="ghost" data-size="sm" hx-get="${body(cur ? `?v=${cur.v}` : "")}" hx-target="#cbody" hx-swap="innerHTML">${t("canvas.closeCompare")}</button></div>` : "";
  const banner = atEdit ? html`<div class="ver-banner">${ic("clock", "ic-sm")}<span class="grow">${t("canvas.atEdit", { note: noteOf(atEdit.note) ?? `#${atEdit.n}`, time: clock(atEdit.at, c.user.tz ?? "UTC") })}</span><button class="btn" data-variant="ghost" data-size="sm" hx-get="${body()}" hx-target="#cbody" hx-swap="innerHTML">${t("canvas.toDraft")}</button>${opts.readonly || atEdit.n === lastEdit?.n ? "" : html`<button class="btn" data-size="sm" hx-post="/speca/canvas/${tab.id}/revert" hx-vals='${JSON.stringify({ n: atEdit.n })}' hx-swap="none">${t("canvas.revertHere")}</button>`}</div>`
    : cur && (cur.v !== last?.v || draft) ? html`<div class="ver-banner">${ic("clock", "ic-sm")}<span class="grow">${t("canvas.viewingVersion", { v: cur.v, n: vs.length })}</span><button class="btn" data-variant="ghost" data-size="sm" hx-get="${body()}" hx-target="#cbody" hx-swap="innerHTML">${draft ? t("canvas.toDraft") : t("canvas.toCurrent")}</button>${opts.readonly ? "" : html`<button class="btn" data-size="sm" hx-post="/speca/canvas/${tab.id}/restore" hx-vals='${JSON.stringify({ v: cur.v })}' hx-swap="none">${t("canvas.restoreToDraft")}</button>`}</div>` : "";
  // comments pinned to the content (the live view of the draft only)
  // a design canvas pins its comments itself (to artboards and their elements), the generic layer stays off
  const design = tab.kind === "speca.design";
  const commentable = !design && !opts.compare && !opts.edit && !cur && !atEdit;
  const open = commentable ? (await c.h.fns.canvas.comments({ itemId: tab.id })).length : 0;
  const cmBtn = commentable ? html`<button type="button" class="btn cmt-btn" data-variant="ghost" data-size="icon-sm" data-act="cmt-toggle" aria-pressed="false" aria-label="${t("cm.title")}" data-tooltip="${t("cm.title")} · C" data-side="bottom">${ic("msg", "ic-sm")}<span class="cmt-n"${open ? "" : raw(" hidden")}>${open}</span></button>` : "";
  const cmAttrs = commentable ? raw(` data-cmt-tab="${tab.id}" data-cmt-ses="${s.id}"${opts.readonly ? ` data-cmt-ro="1"` : ""} data-cmt-l="${commentStrings(t)}"`) : "";
  const kindName = tab.kind;
  const editBtn = tab.kind === "speca.doc" && !opts.readonly && !cur && !atEdit && !opts.compare && !opts.edit ? html`<button class="btn doc-edit-btn" data-variant="ghost" data-size="icon-sm" hx-get="${body("?edit=1")}" hx-target="#cbody" hx-swap="innerHTML" aria-label="${t("canvas.edit")}" data-tooltip="${t("canvas.edit")}" data-side="bottom">${ic("pencil", "ic-sm")}</button>` : "";
  return html`<div class="doc"><div class="doc-h"><span class="path"><span class="kind-ic" role="img" tabindex="0" aria-label="${kindName}" data-tooltip="${kindName}" data-side="bottom">${tabIcon(c, tab.kind)}</span>${tab.title}</span><span class="grow"></span>${cmBtn}${verBar}${editBtn}</div>${banner}${cmpBar}<div class="tab-content${design ? " tab-design" : ""}"${cmAttrs}>${content}${commentable ? html`<i class="cmt-live" hidden data-cmt-ui data-live-topic="comments:${s.id}"></i>` : ""}</div></div>${drawer}`;
}

/** The journal: the draft's edits (newest first: look at a moment, go back to it) and the saved versions with the
 *  edits each was made of. Saving a version starts here, with an optional name. */
export async function journalHtml(c: Ctx, tab: Tab & { version?: number }, o: { readonly: boolean; save: boolean }): Promise<Raw> {
  const t = c.t;
  const vs: Version[] = [...(await c.h.fns.canvas.versions({ itemId: tab.id }))].reverse();
  const edits: Edit[] = (await c.h.fns.canvas.draft({ itemId: tab.id })).edits;
  const tz = c.user.tz ?? "UTC";
  const other = (a: string) => a !== "agent" && a !== "user" && a !== `user:${c.user.id}`;
  const by = (a: string, at: number) => (other(a) ? html`<small>${a.replace(/^user:/, "")} · ${clock(at, tz)}</small>` : "");
  const noteOf = (n: string | null) => (!n ? "—" : /^restored v\d+$/.test(n) ? t("canvas.restoredFrom", { v: n.slice(10) }) : n);
  const look = (q: string) => html`<button class="btn" data-variant="ghost" data-size="icon-sm" hx-get="/speca/canvas/${tab.id}/body?${q}" hx-target="#cbody" hx-swap="innerHTML" data-act="close-dialog" aria-label="${t("canvas.look")}" data-tooltip="${t("canvas.look")}" data-side="left">${ic("eye", "ic-sm")}</button>`;
  const editRow = (e: Edit, i: number) => html`<div class="jr-row"><span class="jr-note">${noteOf(e.note)}</span>${by(e.author, e.at)}<span class="jr-acts">${look(`at=${e.n}`)}${o.readonly || i === 0 ? "" : html`<button class="btn" data-variant="ghost" data-size="icon-sm" hx-post="/speca/canvas/${tab.id}/revert" hx-vals='${JSON.stringify({ n: e.n })}' hx-swap="none" hx-confirm="${t("canvas.revertConfirm", { n: i })}" aria-label="${t("canvas.revertHere")}" data-tooltip="${t("canvas.revertHere")}" data-side="left">${ic("undo", "ic-sm")}</button>`}</span></div>`;
  const verRow = (v: Version) => html`<div class="jr-row jr-ver"><b class="jr-v">v${v.v}</b><span class="jr-note">${v.name ? noteOf(v.name) : v.v === 1 ? t("canvas.created") : v.changes?.length ? html`<span class="muted">${v.changes.map((x) => noteOf(x.note)).join(" · ")}</span>` : "—"}</span>${by(v.author, v.createdAt)}<span class="jr-acts">${o.readonly ? "" : html`<button type="button" class="btn" data-variant="ghost" data-size="icon-sm" data-act="ver-rename" aria-label="${t("canvas.rename")}" data-tooltip="${t("canvas.rename")}" data-side="left">${ic("pencil", "ic-sm")}</button>`}${look(`v=${v.v}`)}</span>${o.readonly ? "" : html`<form class="ver-name" hidden hx-post="/speca/canvas/${tab.id}/versions/${v.v}/name" hx-swap="none" data-journal="/speca/canvas/${tab.id}/journal"><input class="input" name="name" value="${v.name ?? ""}" maxlength="200" placeholder="${t("canvas.versionNamePh")}" autocomplete="off" aria-label="${t("canvas.rename")}"></form>`}</div>`;
  const next = (vs[vs.length - 1]?.v ?? 0) + 1;
  return html`<div class="dlg-form dlg-md jr-dlg"><header class="dlg-h"><div><h2>${ic("logs", "ic-sm")}${t("canvas.journalFull")}</h2><p>${tab.title}</p></div><button type="button" class="btn" data-variant="ghost" data-size="icon-sm" data-act="close-dialog" aria-label="${t("common.close")}">${ic("x")}</button></header>
    ${edits.length && !o.readonly ? html`<form class="jr-save" hx-post="/speca/canvas/${tab.id}/commit" hx-swap="none"><input class="input" name="name" placeholder="${t("canvas.versionNamePh")}" autocomplete="off" ${o.save ? "autofocus" : ""}><button class="btn" data-size="sm">${t("canvas.saveAs", { v: next })}</button></form>` : ""}
    <div class="jr-body">
      ${edits.length ? html`<div class="jr-sub"><i class="draft-dot"></i>${t("canvas.draft")}</div><div class="jr-list">${join([...edits].reverse().map(editRow))}</div>` : ""}
      <div class="jr-sub">${t("canvas.versions")}</div><div class="jr-list">${join([...vs].reverse().map(verRow))}</div>
    </div></div>`;
}

/** The difference of two contents as changed blocks with line numbers (git-style), and a way to ask the agent. */
function diffView(kind: string, a: Record<string, unknown>, b: Record<string, unknown>, t: Ctx["t"], o: { tabId: number; from: string; to: string; readonly: boolean }): Raw {
  const ops = lineDiff(canvasText(kind, a), canvasText(kind, b));
  const hs = hunks(ops, 3);
  const st = stats(ops);
  const head = html`<div class="dv-head"><span class="dv-what">${o.from} → ${o.to}</span><span class="dv-n ins">+${st.added}</span><span class="dv-n del">−${st.removed}</span><span class="grow"></span>
    ${o.readonly ? "" : html`<button class="btn" data-variant="outline" data-size="sm" hx-post="/speca/canvas/${o.tabId}/ask-diff" hx-vals='${JSON.stringify({ from: o.from, to: o.to })}' hx-swap="none">${ic("msg", "ic-sm")}${t("canvas.askDiff")}</button>`}</div>`;
  if (!hs.length) return html`<div class="diffv">${head}<div class="muted-note">${t("canvas.noDiff")}</div></div>`;
  return html`<div class="diffv">${head}${join(hs.map((h) => html`<div class="dv-hunk"><div class="dv-at">@@ −${h.aStart} +${h.bStart} @@</div>${join(h.ops.map((x) => html`<div class="dv-l ${x.k}"><span class="dv-no">${x.a ?? ""}</span><span class="dv-no">${x.b ?? ""}</span><span class="dv-s">${x.k === "ins" ? "+" : x.k === "del" ? "−" : ""}</span><span class="dv-t">${x.text || " "}</span></div>`))}</div>`))}</div>`;
}

/** The frame page of a Hyper kind: Hyper's own stylesheets and canvas script around the kind's body. */
export async function framePage(c: Ctx, sid: string, tabId: number): Promise<Response> {
  const open = (await tabsOf(c, sid)).find((x) => x.id === tabId);
  if (!open) return new Response("not found", { status: 404 });
  // ?ver=N: a saved version; ?at=n: the draft right after edit n (the history drawer and the journal)
  const ver = Number(c.url.searchParams.get("ver")) || null, at = Number(c.url.searchParams.get("at")) || null;
  const tab = ver || at ? { ...open, ...(await c.h.fns.canvas.version({ itemId: open.id, ...(ver ? { v: ver } : { edit: at }) })), shown: ver ? { v: ver } : { edit: at! } } : open;
  const kind = kindsOf(c)[tab.kind];
  let body = "";
  try { body = kind ? String(await kind.render(c.h, { agentId: sid, item: tab })) : `canvas kind "${tab.kind}" is not loaded`; }
  catch (e: any) { body = `<div class="p-6 text-sm text-faint">${String(e?.message ?? e).replace(/</g, "&lt;")}</div>`; }
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const css = ["/ui/vendor/phosphor.css", "/procs/styles/app.css", "/canvas/canvas.css", "/reladraw/reladraw.css", "/mermaid/mermaid.css"];
  const theme = c.user.settings?.theme === "light" ? "light" : c.user.settings?.theme === "dark" ? "dark" : "";
  const page = `<!doctype html><html lang="${c.t.locale}"${theme ? ` data-theme="${theme}"` : ""}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${css.map((h) => `<link rel="stylesheet" href="${h}">`).join("\n")}
<script src="/procs/ui/htmx.js" defer></script><script src="/procs/events/client.js" defer></script><script src="/canvas/canvas.js" defer></script>
<style>html,body{height:100%;margin:0}body{background:transparent}</style></head>
<body class="bg-base-100 text-base-content"><div data-canvas-panel data-agent-id="${esc(sid)}" class="h-full"><div data-canvas-body data-canvas-item="${tab.id}" data-canvas-kind="${esc(tab.kind)}"${(kind as any)?.liveState ? ` data-canvas-state="${esc(JSON.stringify(tab.state))}"` : ""} class="h-full overflow-auto">${body}</div></div></body></html>`;
  return new Response(page, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
