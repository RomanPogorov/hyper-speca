// Page shells. Static files are local (no CDN): Basecoat (Mira) → prototype app.css → product.css.
import { statSync } from "node:fs";
import { join } from "node:path";
import { html, raw, type Raw } from "../html.ts";
import { ic } from "../ui/icons.ts";
import type { App, T, UserRow } from "../types.ts";

// the version of each static file is its modification time: an edit of app.js reaches browsers at once (cached
// forever otherwise), also when the server itself did not restart
const ASSETS = join(import.meta.dir, "..", "..", "assets");
const vCache = new Map<string, { v: string; at: number }>();
function av(path: string): string {
  const hit = vCache.get(path);
  if (hit && Date.now() - hit.at < 1000) return hit.v;
  let v = "0";
  try { v = String(Math.round(statSync(join(ASSETS, path)).mtimeMs)); } catch { /* missing */ }
  vCache.set(path, { v, at: Date.now() });
  return v;
}

/** The versions of the stylesheets, sent with every htmx answer: a page open since before a style edit swaps in the
 *  new files by itself (app.js), so new markup never meets old styles. */
export const CSS_FILES = ["vendor/basecoat.css", "css/app.css", "css/product.css"] as const;
export function cssVersions(): string {
  return CSS_FILES.map((f) => `${f}=${av(f)}`).join(",");
}

function brandingStyle(app: App): Raw {
  const th = app.config.branding.theme;
  const vars = (o: Record<string, string>) => Object.entries(o).filter(([k]) => /^--?[a-z0-9-]+$/i.test(k)).map(([k, v]) => `${k.startsWith("--") ? k : `--${k}`}:${v.replace(/[;{}<>]/g, "")}`).join(";");
  const light = vars(th.light);
  const dark = vars(th.dark);
  return raw(`${light ? `<style>:root{${light}}</style>` : ""}${dark ? `<style>:root[data-theme="dark"]{${dark}}</style>` : ""}`);
}

/** One canvas tab alone, for a screenshot of it (the background browser opens this, not the app). */
export function shotPage(o: { app: App; t: T; me: UserRow; csrf: string; title: string; body: Raw; fixed?: boolean }): Raw {
  const theme = o.me.settings.theme && o.me.settings.theme !== "system" ? o.me.settings.theme : "";
  return html`<!doctype html><html lang="${o.t.locale}" ${theme ? raw(`data-theme="${theme}"`) : ""}><head>${head(o.app, o.t, o.title, o.me)}</head>
  <body class="shot${o.fixed ? " fixed" : ""}" hx-headers='${JSON.stringify({ "x-csrf": o.csrf })}' data-user="${o.me.id}"><div class="canvas-in" id="canvas-in"><div class="cbody" id="cbody">${o.body}</div></div></body></html>`;
}

function head(app: App, t: T, title: string, me?: UserRow): Raw {
  return html`<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · ${app.config.branding.productName}</title>
    <link rel="icon" href="${app.config.branding.logo ?? "/speca/assets/img/icon.svg"}">
    <link rel="stylesheet" href="/speca/assets/vendor/basecoat.css?v=${av("vendor/basecoat.css")}">
    <link rel="stylesheet" href="/speca/assets/css/app.css?v=${av("css/app.css")}">
    <link rel="stylesheet" href="/speca/assets/css/product.css?v=${av("css/product.css")}">
    ${brandingStyle(app)}
    <script src="/speca/assets/vendor/htmx.js?v=${av("vendor/htmx.js")}"></script>
    <script src="/speca/assets/vendor/basecoat.js?v=${av("vendor/basecoat.js")}" defer></script>
    <script src="/speca/assets/js/app.js?v=${av("js/app.js")}" defer></script>
    <script src="/speca/assets/js/cmt-core.js?v=${av("js/cmt-core.js")}" defer></script>
    <script src="/speca/assets/js/comments.js?v=${av("js/comments.js")}" defer></script>
    ${me?.settings.msgRail ? html`<script src="/speca/assets/js/rail.js?v=${av("js/rail.js")}" defer></script>` : ""}
    <meta name="dh-locale" content="${t.locale}">`;
}

export type ShellOpts = {
  app: App; t: T; me: UserRow; csrf: string; title: string;
  sidebar: Raw; chat?: Raw | null; canvas: Raw; side?: Raw | null;
  view?: string; chatSide?: string; sideOpen?: boolean; page?: string;
  /** Only the chat, for a drawer over another chat (a subagent opened from its parent). */
  pane?: boolean;
};

export function shell(o: ShellOpts): Raw {
  const theme = o.me.settings.theme && o.me.settings.theme !== "system" ? o.me.settings.theme : "";
  const view = o.view ?? o.me.settings.view ?? "full";
  const sideOpen = o.side ? (o.sideOpen ?? o.me.settings.sideOpen ?? true) : false;
  return html`<!doctype html><html lang="${o.t.locale}" ${theme ? raw(`data-theme="${theme}"`) : ""}><head>${head(o.app, o.t, o.title, o.me)}</head>
  <body hx-headers='${JSON.stringify({ "x-csrf": o.csrf })}' data-user="${o.me.id}" data-page="${o.page ?? ""}" data-lbox='${JSON.stringify({ close: o.t("common.close"), download: o.t("files.download") })}' data-pal='${JSON.stringify({ title: o.t("pal.title"), ph: o.t("pal.ph"), none: o.t("pal.none"), move: o.t("pal.hintMove"), open: o.t("pal.hintOpen"), close: o.t("pal.hintClose"), qicon: String(ic("search", "ic-sm")) }).replace(/'/g, "&#39;")}'${o.pane ? raw(` class="pane"`) : ""}>
    <template id="viewmenu-tpl"><div class="cm-h">${ic("layout", "ic-xs")}${o.t("view.title")}</div>${raw([["full", "layout"], ["work", "appWindow"], ["chat", "msg"], ["solo", "sparkle"], ["canvas", "panelTop"], ["focus", "fullscreen"]].map(([v, i], n) => `<button class="cm-i" role="menuitem" data-view="${v}"><span class="vm-ic">${ic(i!).toString()}</span><span class="vm-ok">${ic("check").toString()}</span><span><span class="vm-l">${o.t(`view.v.${v}` as never)}</span><small>${o.t(`view.h.${v}` as never)}</small></span><span class="sc" data-sc="${n + 1}">⌘${n + 1}</span></button>`).join(""))}</template>
    <div class="app" id="app" data-chat="${o.chat ? (o.chatSide ?? o.me.settings.chatSide ?? "right") : "none"}" data-side="${sideOpen ? "open" : "closed"}" data-sb="${o.me.settings.sbRail ? "rail" : "open"}" data-view="${view}" data-ctx="none" data-mview="chat" data-focus-hint="${o.t("view.focusHint")}">
      <aside class="sb" id="sb" aria-label="${o.t("sb.aria")}">${o.sidebar}</aside>
      <div class="mbar" id="mbar"><button class="btn" data-variant="ghost" data-size="icon-sm" data-act="sb-open-m" aria-label="${o.t("sb.aria")}">≡</button><span class="ttl">${o.title}</span>
        ${o.chat ? html`<div class="seg" role="group"><button data-act="mview" data-v="chat" aria-pressed="true">${o.t("view.chat")}</button><button data-act="mview" data-v="canvas" aria-pressed="false">${o.t("view.canvas")}</button></div>` : ""}</div>
      <main class="stage" id="stage">
        ${o.chat ? html`<section class="chat" id="chat" aria-label="${o.t("chat.aria")}">${o.chat}</section><script src="/speca/assets/js/log-end.js?v=${av("js/log-end.js")}"></script><div class="rz" id="rz" role="separator" aria-orientation="vertical" tabindex="0"></div><button class="chatpop-fab" data-act="chat-pop" aria-pressed="false" aria-label="${o.t("view.chatPop")}" data-tooltip="${o.t("view.chatPop")} · ⌘J" data-side="top">${ic("chatDots")}<i class="cp-mark" aria-hidden="true"></i></button>` : ""}
        <aside class="ctxl" id="ctxl"></aside>
        <section class="canvas" id="canvas" aria-label="${o.t("canvas.aria")}">${o.canvas}</section>
        <aside class="side" id="side" aria-label="${o.t("side.aria")}">${o.side ?? ""}</aside>
      </main>
      <div class="scrim" id="scrim" data-act="sb-close-m"></div>
    </div>
    <dialog class="dialog dh-dialog" id="dlg" aria-modal="true"><div id="dlg-body"></div></dialog>
    <div id="toaster" class="toaster"></div>
        <div id="live-status" class="vh" role="status" aria-live="polite"></div>
  </body></html>`;
}

/** Simple centered page (sign-in, setup, join). */
export function plainPage(app: App, t: T, title: string, body: Raw, opts: { wide?: boolean; csrf?: string | null } = {}): Raw {
  return html`<!doctype html><html lang="${t.locale}"><head>${head(app, t, title)}</head>
  <body class="plain" ${opts.csrf ? raw(`hx-headers='${JSON.stringify({ "x-csrf": opts.csrf })}'`) : ""}><main class="plain-main ${opts.wide ? "wide" : ""}">${body}</main>
    <dialog class="dialog dh-dialog" id="dlg" aria-modal="true"><div id="dlg-body"></div></dialog><div id="toaster" class="toaster"></div></body></html>`;
}
