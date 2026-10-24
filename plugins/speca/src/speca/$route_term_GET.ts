// GET /speca/term?s=<place> — the terminal on a page of its own, full screen (a phone: add it to the home screen);
// without ?s it lists the places.
import { route } from "../../web/route.ts";
import { html } from "../../web/html.ts";
import { termView, TERM_ASSETS, T, MAC } from "../../web/term.ts";

export default route(async (c) => {
  const s = c.url.searchParams.get("s") ?? "";
  const t = T(c.t.locale);
  const title = s ? `${s === MAC ? t.mac : s} · ${t.title}` : t.title;
  const page = html`<!doctype html><html lang="${c.t.locale}" class="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<meta name="theme-color" content="#0f1115"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><title>${title}</title></head>
<body class="sterm-page">${await termView(c.h, c.t.locale, s, { full: true })}${TERM_ASSETS}</body></html>`;
  return new Response(String(page), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "referrer-policy": "no-referrer" } });
});
