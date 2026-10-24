// The one sandbox for pages the agent writes (a design canvas's artboards, their previews and comparisons) — Speca's
// core/web/sandbox.ts. The boundary is the opaque origin and the lack of network: the page can't read the app, its
// cookies or anything of the person's, and can't send anything anywhere. Inside it a page works like any web app.
import { raw, type Raw } from "../html.ts";

/** The iframe's attributes. allow-forms lets the submit event fire (the shim below keeps the page from navigating). */
export const SANDBOX_FLAGS = "allow-scripts allow-forms allow-modals";
export const sandboxAttrs = (): Raw => raw(`sandbox="${SANDBOX_FLAGS}" allow="clipboard-write" referrerpolicy="no-referrer"`);

/** The page's policy: its own code (nonce'd scripts, inline handlers, eval); no network, no navigation out. */
export function sandboxCsp(nonce: string, origin: string): string {
  const libs = `${origin}/canvas-libs/`;
  return [
    `sandbox ${SANDBOX_FLAGS}`, "default-src 'none'", "base-uri 'none'",
    `script-src 'nonce-${nonce}' 'unsafe-eval' 'wasm-unsafe-eval' blob: ${libs}`, "script-src-attr 'unsafe-inline'",
    `style-src 'unsafe-inline' ${libs}`, `font-src data: ${libs}`, `img-src data: blob: ${libs}`, "media-src data: blob:", "worker-src blob:",
    "connect-src 'none'", "form-action 'none'", "frame-ancestors 'self' http://localhost:* http://*.localhost:* http://127.0.0.1:*",
  ].join("; ");
}

/** First script of the page: what an opaque origin lacks, made to work in memory; what can't work said out loud. */
export function sandboxShim(nonce: string): string {
  return `<script nonce="${nonce}">(() => {
  const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null), setItem: (k, v) => { m.set(String(k), String(v)); }, removeItem: (k) => { m.delete(String(k)); }, clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } }; };
  for (const name of ["localStorage", "sessionStorage"]) { let ok = false; try { ok = !!window[name]; } catch {} if (!ok) try { Object.defineProperty(window, name, { value: mem(), configurable: true }); } catch {} }
  try { void document.cookie; } catch { const jar = new Map(); try { Object.defineProperty(document, "cookie", { configurable: true, get: () => [...jar].map(([k, v]) => k + "=" + v).join("; "), set: (s) => { const [kv] = String(s).split(";"); const i = kv.indexOf("="); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); } }); } catch {} }
  window.open = (url) => { console.error("[canvas] window.open is not available in a canvas page" + (url ? ": " + url : "")); return null; };
  addEventListener("keydown", (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const app = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (k === "j" || /^[1-6]$/.test(k));
    if (app) e.preventDefault();
    if (app || (k === "Escape" && !e.defaultPrevented)) try { top.postMessage({ dhKey: k }, "*"); } catch {}
  });
  addEventListener("submit", (e) => { if (!e.defaultPrevented) e.preventDefault(); });
  addEventListener("click", (e) => {
    const a = e.target && e.target.closest && e.target.closest("a[href]"); if (!a || e.defaultPrevented) return;
    const h = a.getAttribute("href") || ""; if (!h || h[0] === "#") return;
    e.preventDefault();
    if (/^javascript:/i.test(h)) { try { new Function(decodeURIComponent(h.slice(11))).call(a); } catch (err) { console.error(err); } return; }
    console.error("[canvas] links do not leave a canvas page: " + h);
  });
})();</script>`;
}

/** The base styles of an artboard page: the root fills the board, system fonts. */
export const BOARD_CSS = `html,body{margin:0}html,body{height:100%}body>:is(div,section,main,article,header,footer,aside,nav,form){width:100%!important;max-width:100%!important;box-sizing:border-box}body:not(:has(>:is(div,section,main,article,header,footer,aside,nav,form)~:is(div,section,main,article,header,footer,aside,nav,form)))>:is(div,section,main,article,header,footer,aside,nav,form){height:100%!important}body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}`;
