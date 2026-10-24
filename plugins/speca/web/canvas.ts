// The canvas beside the chat, Speca's way: a tab strip (rename, close, "+", all tabs, view menu) and the active tab's body.
// Tabs are Hyper's canvas items (canvas.list / canvas.update / canvas.close); a kind's body is drawn by its own
// `$canvas_<kind>.ts`. Hyper's kinds style themselves with Hyper's stylesheet, so their body runs in a frame page
// (/speca/s/:id/tab/:tab/frame) that carries Hyper's CSS and canvas script; Speca's kinds draw in place.
import { html, join, raw, type Raw } from "./html.ts";
import { ic } from "./ui/icons.ts";
import { getSession, type HSession } from "./hyper.ts";
import type { Ctx } from "./route.ts";

export type Tab = { id: number; agentId: string; kind: string; title: string; args: Record<string, any>; state: Record<string, any>; active: boolean; createdAt: number; updatedAt: number; closedAt: number | null };

/** Kinds Speca draws itself (in the page, with Speca's styles); the rest are Hyper's and go into a frame. */
export const SPECA_KINDS = new Set<string>();

const kindsOf = (c: Ctx): Record<string, { icon?: string; render: Function }> => (c.h.state as any).canvas?.kinds ?? {};
const tabIcon = (c: Ctx, kind: string) => ic(`ph:${kindsOf(c)[kind]?.icon ?? "app-window"}`, "ic-sm tico");

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

export async function tabBody(c: Ctx, s: HSession, tab: Tab): Promise<Raw> {
  const kind = kindsOf(c)[tab.kind];
  if (!kind) return html`<div class="empty-canvas small">${ic("puzzle")}<p>${c.t("canvas.unknownKind", { kind: tab.kind })}</p></div>`;
  if (SPECA_KINDS.has(tab.kind)) {
    try { return raw(String(await kind.render(c.h, { agentId: s.id, item: tab }))); }
    catch (e: any) { return html`<div class="errcard">${ic("alert", "ic-sm")}${String(e?.message ?? e)}</div>`; }
  }
  // the frame is keyed by the tab's last change, so a new state reloads it and an unchanged one stays put
  return html`<iframe class="hyper-frame" title="${tab.title}" src="/speca/s/${s.id}/tab/${tab.id}/frame?v=${tab.updatedAt}" style="border:0;width:100%;height:100%;display:block;background:var(--bg)"></iframe>`;
}

/** The frame page of a Hyper kind: Hyper's own stylesheets and canvas script around the kind's body. */
export async function framePage(c: Ctx, sid: string, tabId: number): Promise<Response> {
  const tab = (await tabsOf(c, sid)).find((x) => x.id === tabId);
  if (!tab) return new Response("not found", { status: 404 });
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
