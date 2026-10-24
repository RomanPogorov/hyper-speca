// Speca's design canvas as a Hyper canvas kind (speca.design): artboards (one sandboxed iframe each, 1:1) in one world
// moved by a camera; the host (assets/design/dcv.js) draws the selection, the properties panel, menus, comments and
// the preview over it. The content is the tab's args — the index (boards, order, row titles, notes, pages) and one
// HTML file per artboard — so it has a draft, versions, undo per artboard and comparisons like any tab.
// Ported from Speca's plugins/design-canvas/board.canvas.ts.
import { join as pjoin } from "node:path";
import { html, join, type Raw } from "../html.ts";
import { ic } from "../ui/icons.ts";
import { checkState, version, sheetOf, sheetsOf, type DesignState } from "./model.ts";
import { renderKey, render } from "./template.ts";
import { L, C } from "./strings.ts";
import { diffBoard, type Change } from "./diff.ts";
import { sandboxAttrs } from "./sandbox.ts";

const ASSET_DIR = pjoin(import.meta.dir, "..", "..", "assets", "design");
const A = "/speca/assets/design";
// The assets are named by their content's hash: a page that keeps running gets the new scripts on its next render.
const ASSETS = ["dck.css", "dcv.css", "dck.js", "panel.js", "dcv.js", "dcc.js"];
let assetsKey = { at: 0, v: "" };
export async function assetsVersion(): Promise<string> {
  if (Date.now() - assetsKey.at < 2000) return assetsKey.v;
  const texts = await Promise.all(ASSETS.map((f) => Bun.file(pjoin(ASSET_DIR, f)).text()));
  assetsKey = { at: Date.now(), v: Bun.hash(texts.join("\0")).toString(36) };
  return assetsKey.v;
}

type Item = { id: number; agentId?: string; kind: string; title: string; args: Record<string, any>; state?: Record<string, any>; shown?: { v?: number; edit?: number } };
type Ui = { t: { locale: string }; user: { id: string } };
const lang = (ui?: { t: { locale: string } }) => (ui?.t.locale === "ru" ? "ru" : "en");

export const hint = "a design canvas: screens and their states as artboards on an infinite canvas, in rows by flow — open and change it ONLY with the design functions, not canvas.show / canvas.write: speca.designOpen({ title, rows: [{ title?, boards: [{ file: \"01-welcome.html\", title: \"01 Welcome\", w, h }] }] }) opens it with every artboard waiting, then speca.designWrite({ tabId, file, html }) draws them one by one in order; speca.designEdit({ tabId, file, edits: [{ old, new }] }) changes part of one; speca.designRead({ tabId, file? }) reads the index (artboards, notes, open comments) or one artboard with its element outline (tids); speca.designLayout({ tabId, ops }) moves, resizes, renames, removes boards, adds row titles and stickies, moves boards to pages, replies to and resolves comments. Phone 390×844, desktop 1440×900, slide 1280×720. speca.designGuide() returns the full rules of artboard files (read it before the first artboard)";

export const kind = {
  icon: "pen-nib",
  // one artboard drawn or edited = one undo step (a whole answer can draw a dozen of them)
  undo: "each" as const,
  prepare(_ctx: Context, o: { args: Record<string, any> }) {
    const r = checkState(o.args);
    if (!r.ok) throw new Error(`canvas speca.design: ${r.error} — open it with speca.designOpen`);
    return { args: r.state, ...(r.state.title ? { title: r.state.title.slice(0, 120) } : {}) };
  },
  async render(_ctx: Context, o: { agentId: string; item: Item; ui?: Ui }) {
    return String(await boardHtml(o.item, o.agentId, o.ui));
  },
  describe(_ctx: Context, o: { item: Item }) {
    const s = o.item.args as DesignState;
    const waiting = (s.order ?? []).filter((f) => s.boards?.[f]?.pending);
    return `design canvas, ${(s.order ?? []).length} artboard(s)${waiting.length ? `, ${waiting.length} waiting to be drawn (${waiting.join(", ")})` : ""}${sheetsOf(s).length > 1 ? `, pages: ${sheetsOf(s).map((p) => p.title).join(", ")}` : ""} — read it with speca.designRead({ tabId: ${o.item.id} }), change it with speca.designWrite / designEdit / designLayout`;
  },
};

async function boardHtml(item: Item, sid: string, ui?: Ui): Promise<Raw> {
  const lg = lang(ui), l = L[lg];
  const s = item.args as DesignState, tabId = item.id, av = await assetsVersion();
  // a saved version or a moment of the draft: the frames show that state, not the draft
  const ver = item.shown?.v ?? null, at = item.shown?.edit ?? null;
  const moment = ver != null ? `&ver=${ver}` : at != null ? `&at=${at}` : "";
  // planned artboards wait in their frames, in order: the first one is the one being drawn while the agent works
  const waiting = s.order.filter((f) => s.boards[f]?.pending), drawn = s.order.filter((f) => s.boards[f] && !s.boards[f]!.pending).length;
  const boards = s.order.filter((f) => s.boards[f]).map((f) => {
    const b = s.boards[f]!, v = version(s.files[f] ?? ""), k = renderKey(f, s.files);
    if (b.pending) return html`<div class="dcv-board pending${f === waiting[0] ? " next" : ""}" data-file="${f}" data-sheet="${sheetOf(s, b)}" data-title="${b.title}" data-v="" data-k="pending" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px">
        <div class="dcv-name"><span>${b.title}</span></div>
        <div class="dcv-wait"><span class="dcv-wait-now"><i class="spin"></i>${l.drawing}</span><span class="dcv-wait-later">${f === waiting[0] ? l.notDrawn : l.queued}</span></div>
        <div class="dcv-rings"></div></div>`;
    return html`<div class="dcv-board" data-file="${f}" data-sheet="${sheetOf(s, b)}" data-title="${b.title}" data-v="${v}" data-k="${k}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px">
        <div class="dcv-name"><span>${b.title}</span></div>
        <iframe ${sandboxAttrs()} data-src="/speca/design/board/${tabId}/${encodeURIComponent(f)}?v=${k}${moment}" title="${b.title}" width="${b.w}" height="${b.h}"></iframe>
        <div class="dcv-ph" aria-hidden="true"></div><div class="dcv-rings"></div><i class="dcv-rz" data-rz="e"></i><i class="dcv-rz" data-rz="s"></i><i class="dcv-rz" data-rz="se"></i></div>`;
  });
  const notes = Object.entries(s.notes ?? {}).map(([id, n]) => html`<div class="dcv-note ${n.kind}" data-note="${id}" data-sheet="${sheetOf(s, n)}" style="left:${n.x}px;top:${n.y}px;${n.w && n.kind !== "title" ? `width:${n.w}px` : ""}">${n.text}</div>`);
  const tool = (a: string, label: string, icon: string) => html`<button type="button" class="dk-ib" data-dcv="${a}" aria-label="${label}" data-tooltip="${label}" data-side="top">${ic(icon, "ic-sm")}</button>`;
  const strings = { ...C[lg], copied: l.copied, stale: l.stale, notSaved: l.notSaved, ask: l.ask };
  // the artboard the agent pointed the person at (speca.designWrite / designEdit): by its file, else by its title
  const focus = item.state?.focus as { target?: string; at?: number; follow?: boolean } | undefined;
  const want = String(focus?.target ?? "").trim().toLowerCase();
  const focusFile = !want ? "" : s.order.find((f) => f.toLowerCase() === want || f.toLowerCase() === `${want}.html`)
    ?? s.order.find((f) => (s.boards[f]?.title ?? "").toLowerCase() === want)
    ?? s.order.find((f) => (s.boards[f]?.title ?? "").toLowerCase().includes(want) || want.includes((s.boards[f]?.title ?? "\u0000").toLowerCase())) ?? "";
  const C_ = C[lg];
  return html`<div class="dcv dk-scope" data-js="${av}" data-tab="${tabId}" data-focus="${focusFile}" data-focus-at="${focusFile ? String(focus?.at ?? "") : ""}" data-follow="${focusFile && focus?.follow ? "1" : ""}" data-me="${ui?.user.id ?? ""}" data-ro="${ver != null || at != null ? "1" : ""}" data-l="${JSON.stringify(strings)}" data-sheets="${JSON.stringify(sheetsOf(s))}">
      <i hidden class="dcv-live" data-live-topic="${sid ? `presence:${sid}` : ""}"></i><i hidden class="dcv-clive" data-live-topic="${sid ? `comments:${sid}` : ""}"></i>
      <div class="dcv-stage" tabindex="0">
        <div class="dcv-world">${join(notes)}${join(boards)}<div class="dcv-guides"></div><div class="dcv-cursors"></div></div>
        ${!boards.length ? html`<div class="dcv-empty">${ic("penTool")}<span>${l.empty}</span></div>` : ""}
        <div class="dcv-marq" hidden></div>
        <div class="dcv-selbar dk-bar" hidden></div>
        <div class="dcv-zoom dk-bar"><span class="dcv-peers"></span><span class="dcv-prog">${waiting.length ? html`<span class="dk-txt dcv-progress"><i class="spin"></i>${l.progress.replace("{n}", String(drawn)).replace("{m}", String(drawn + waiting.length))}</span><span class="dk-vsep"></span>` : ""}</span>
          <button type="button" class="dk-ib" data-dcv="out" aria-label="${l.zoomOut}" data-tooltip="${l.zoomOut}" data-side="top">−</button>
          <button type="button" class="dcv-pct" data-dcv="100">100%</button>
          <button type="button" class="dk-ib" data-dcv="in" aria-label="${l.zoomIn}" data-tooltip="${l.zoomIn}" data-side="top">+</button>
          ${tool("fit", `${l.fit} · ⌘0`, "layout")}
          <span class="dk-vsep"></span>
          <button type="button" class="dk-ib dcv-sbtn" data-dcv="sheets" aria-label="${C_.sheets}" data-tooltip="${C_.sheets}" data-side="top">${ic("pages", "ic-sm")}<span class="dcv-sname"></span></button>
          <button type="button" class="dk-ib dcv-cbtn" data-dcv="comments" aria-pressed="false" aria-label="${l.comments}" data-tooltip="${l.comments} · C" data-side="top">${ic("msg", "ic-sm")}<span class="dk-badge dcv-cbadge" hidden></span></button>
          <button type="button" class="dk-btn dk-primary dcv-sendall" data-dcv="send-all" hidden>${ic("send", "ic-sm")}<span></span></button>
          <button type="button" class="dk-ib dcv-rbtn" data-dcv="resolved" aria-pressed="false" aria-label="${C_.showResolved}" data-tooltip="${C_.showResolved}" data-side="top" hidden>${ic("check", "ic-sm")}</button>
          <button type="button" class="dk-ib dcv-clear" data-dcv="clear-comments" aria-label="${C_.clearAll}" data-tooltip="${C_.clearAll}" data-side="top" hidden>${ic("trash", "ic-sm")}</button>
          <button type="button" class="dk-ib" data-dcv="panel" aria-pressed="false" aria-label="${l.panel}" data-tooltip="${l.panel}" data-side="top">${ic("sliders", "ic-sm")}</button>
          <span class="dcv-help" data-tooltip="${l.hint}" data-side="top">?</span></div>
      </div>
      <aside class="dcv-panel" hidden></aside>
      <div class="dcv-menu dk-menu" role="menu" hidden></div>
      <div class="dcv-play" hidden><div class="dcv-play-h"><span class="dcv-play-t"></span><span class="grow"></span>
        ${tool("play-prev", C_.play_prev, "chevLeft")}${tool("play-next", C_.play_next, "chevRight")}${tool("play-close", l.close, "x")}</div>
        <div class="dcv-play-stage"></div></div>
    </div>
    <link rel="stylesheet" href="${A}/dck.css?v=${av}"><link rel="stylesheet" href="${A}/dcv.css?v=${av}"><script src="${A}/dck.js?v=${av}"></script><script src="${A}/panel.js?v=${av}"></script><script src="${A}/dcv.js?v=${av}"></script>`;
}

/** Two states of the canvas, as a designer compares them: per artboard that changed, came or went — what exactly
 *  changed (texts, styles, pictures, elements added and removed) and both pictures, side by side or as a swipe. */
export async function compareHtml(a: DesignState, b: DesignState, o: { tabId: number; from: string; to: string; fromV: number | null; toV: number | null; locale: string }): Promise<Raw> {
  const l = L[o.locale === "ru" ? "ru" : "en"];
  const av = await assetsVersion();
  const files = [...b.order.filter((f) => b.boards[f]), ...a.order.filter((f) => a.boards[f] && !b.boards[f])];
  const kind = (f: string) => !a.boards[f] ? "added" : !b.boards[f] ? "removed"
    : a.files[f] !== b.files[f] || a.boards[f]!.w !== b.boards[f]!.w || a.boards[f]!.h !== b.boards[f]!.h || a.boards[f]!.title !== b.boards[f]!.title ? "changed" : "same";
  const rows = files.map((f) => ({ f, k: kind(f) })).filter((r) => r.k !== "same");
  const same = files.length - rows.length;
  const count = (k: string) => rows.filter((r) => r.k === k).length;
  const q = (s: string) => `«${s}»`;
  const changeLine = (c: Change) => {
    const lab = (t: string) => html`<span class="dcc-ck">${t}</span>`;
    switch (c.kind) {
      case "text": return html`<li>${lab(l.cmpText)}<s>${q(c.before)}</s><span class="dcc-arrow">→</span><b>${q(c.after)}</b></li>`;
      case "style": return html`<li>${lab(l.cmpStyle)}${join(c.props.map((p) => html`<code>${p.prop}</code> ${p.before ? html`<s>${p.before}</s>` : "—"}<span class="dcc-arrow">→</span>${p.after ? html`<b>${p.after}</b>` : "—"}`), "; ")}</li>`;
      case "class": return html`<li>${lab(l.cmpClass)}<s>${c.before || "—"}</s><span class="dcc-arrow">→</span><b>${c.after || "—"}</b></li>`;
      case "image": return html`<li>${lab(l.cmpImage)}</li>`;
      case "link": return html`<li>${lab(l.cmpLink)}<s>${c.before || "—"}</s><span class="dcc-arrow">→</span><b>${c.after || "—"}</b></li>`;
      case "css": return html`<li>${lab(l.cmpCss)}</li>`;
      case "added": return html`<li class="add">${lab(l.cmpNew)}<b>${c.text ? q(c.text) : `<${c.tag}>`}</b></li>`;
      case "removed": return html`<li class="del">${lab(l.cmpGone)}<s>${c.text ? q(c.text) : `<${c.tag}>`}</s></li>`;
    }
  };
  const frame = (f: string, v: number | null, st: DesignState, cls = "") => {
    const bd = st.boards[f]!;
    return html`<iframe class="${cls}" sandbox loading="lazy" src="/speca/design/snapshot/${o.tabId}/${encodeURIComponent(f)}${v != null ? `?ver=${v}` : ""}" width="${bd.w}" height="${bd.h}" title="${bd.title}"></iframe>`;
  };
  const side = (label: string, f: string, v: number | null, st: DesignState, present: boolean) =>
    html`<div class="dcc-side"><div class="dcc-cap">${label}</div>${present ? html`<div class="dcc-scroll"><div class="dcc-frame">${frame(f, v, st)}</div></div>` : html`<div class="dcc-none">${l.cmpNone}</div>`}</div>`;
  const row = (r: { f: string; k: string }) => {
    const ba = a.boards[r.f], bb = b.boards[r.f], title = (bb ?? ba)!.title;
    // compared as drawn: a template's data (texts, colours) shows in what changed
    const drawn = (st: DesignState) => render(st.files[r.f] ?? "", st.files, undefined, { tids: false, depth: 0, seen: new Set() });
    const changes: Change[] = r.k === "changed" ? diffBoard(drawn(a), drawn(b)) : [];
    const lines: Raw[] = [];
    if (r.k === "added") lines.push(html`<li class="add">${l.cmpNewBoard}</li>`);
    if (r.k === "removed") lines.push(html`<li class="del">${l.cmpGoneBoard}</li>`);
    if (ba && bb && ba.title !== bb.title) lines.push(html`<li><span class="dcc-ck">${l.cmpTitle}</span><s>${q(ba.title)}</s><span class="dcc-arrow">→</span><b>${q(bb.title)}</b></li>`);
    if (ba && bb && (ba.w !== bb.w || ba.h !== bb.h)) lines.push(html`<li><span class="dcc-ck">${l.cmpSize}</span><s>${ba.w}×${ba.h}</s><span class="dcc-arrow">→</span><b>${bb.w}×${bb.h}</b></li>`);
    lines.push(...changes.map(changeLine));
    if (r.k === "changed" && !lines.length) lines.push(html`<li>${l.cmpLooks}</li>`);
    const SHOW = 8, more = lines.length - SHOW;
    const both = r.k === "changed" && a.files[r.f] !== undefined && b.files[r.f] !== undefined;
    return html`<section class="dcc-row" data-kind="${r.k}">
        <div class="dcc-t"><b>${title}</b><span class="pill p3 dcc-${r.k}">${l[`cmp_${r.k}` as "cmp_changed"]}</span></div>
        <ul class="dcc-ch">${join(lines.slice(0, SHOW))}${more > 0 ? html`<li class="dcc-more"><details><summary>${l.cmpMore.replace("{n}", String(more))}</summary><ul class="dcc-ch">${join(lines.slice(SHOW))}</ul></details></li>` : ""}</ul>
        <div class="dcc-pair">${side(o.from, r.f, o.fromV, a, !!ba && a.files[r.f] !== undefined)}${side(o.to, r.f, o.toV, b, !!bb && b.files[r.f] !== undefined)}</div>
        ${both ? html`<div class="dcc-swipe" style="--x:50%"><div class="dcc-caps"><span>${o.from}</span><span>${o.to}</span></div><div class="dcc-scroll"><div class="dcc-frame">${frame(r.f, o.fromV, a, "under")}${frame(r.f, o.toV, b, "over")}<i class="dcc-line"></i></div></div><input type="range" min="0" max="100" value="50" aria-label="${l.cmpDrag}"></div>` : ""}
      </section>`;
  };
  const seg = (key: string, items: Array<[string, string]>, on: string) => html`<div class="seg" role="group">${join(items.map(([v, label]) => html`<button type="button" data-dcc-set="${key}:${v}" aria-pressed="${v === on}">${label}</button>`))}</div>`;
  const filters: Array<[string, string]> = [["all", `${l.cmpAll} ${rows.length}`], ...(["changed", "added", "removed"] as const).filter((k) => count(k)).map((k): [string, string] => [k, `${l[k === "changed" ? "cmpChanged" : k === "added" ? "cmpAdded" : "cmpRemoved"]} ${count(k)}`])];
  return html`<div class="dcc dk-scope" data-mode="side" data-filter="all">
      <header class="dcc-h"><div class="dcc-ht"><b>${o.from} → ${o.to}</b><span>${l.cmpSummary.replace("{c}", String(count("changed"))).replace("{a}", String(count("added"))).replace("{r}", String(count("removed"))).replace("{s}", String(same))}</span></div>
        ${rows.length ? html`<div class="dcc-ctl">${filters.length > 2 ? seg("filter", filters, "all") : ""}${count("changed") ? seg("mode", [["side", l.cmpSide], ["swipe", l.cmpSwipe]], "side") : ""}</div>` : ""}</header>
      ${rows.length ? join(rows.map(row)) : html`<div class="dcc-empty">${l.cmpSame}</div>`}
      <link rel="stylesheet" href="${A}/dck.css?v=${av}"><link rel="stylesheet" href="${A}/dcv.css?v=${av}"><script src="${A}/dcc.js?v=${av}"></script></div>`;
}
