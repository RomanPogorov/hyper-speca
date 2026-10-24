// Artboards as standalone HTML to download: one artboard, or all of them on one page (each on its own printed page,
// so "Print → Save as PDF" makes a deck). Rendered like the frame, without the editor's numbering.
import { render } from "./template.ts";
import type { DesignState } from "./model.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const BASE = `html,body{margin:0}html,body{height:100%}body>:is(div,section,main,article,header,footer,aside,nav,form){width:100%!important;max-width:100%!important;box-sizing:border-box}body:not(:has(>:is(div,section,main,article,header,footer,aside,nav,form)~:is(div,section,main,article,header,footer,aside,nav,form)))>:is(div,section,main,article,header,footer,aside,nav,form){height:100%!important}body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}`;

export function boardHtml(s: DesignState, file: string): string {
  const b = s.boards[file]!;
  const body = render(s.files[file] ?? "", s.files, undefined, { tids: false, depth: 0, seen: new Set() });
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=${b.w}"><title>${esc(b.title)}</title><style>${BASE}</style></head><body>${body}</body></html>`;
}

export function allHtml(s: DesignState): string {
  const pages = s.order.filter((f) => s.boards[f]).map((f) => {
    const b = s.boards[f]!;
    const body = render(s.files[f] ?? "", s.files, undefined, { tids: false, depth: 0, seen: new Set() });
    return `<section class="dc-page"><h2>${esc(b.title)}</h2><div class="dc-frame" style="width:${b.w}px;height:${b.h}px">${body}</div></section>`;
  });
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(s.title ?? "Design")}</title><style>${BASE}
body{background:#f3f3f4;padding:40px}h1{font-size:28px;margin:0 0 32px}.dc-page{margin:0 0 56px}.dc-page h2{font-size:15px;font-weight:600;color:#555;margin:0 0 12px}
.dc-frame{position:relative;overflow:hidden;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.12)}
@media print{body{background:#fff;padding:0}h1{display:none}.dc-page{break-after:page;margin:0}.dc-frame{box-shadow:none}}</style></head>
<body><h1>${esc(s.title ?? "")}</h1>${pages.join("\n")}</body></html>`;
}
