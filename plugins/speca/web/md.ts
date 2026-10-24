// Markdown for model and person text: raw HTML is escaped, links are limited to safe schemes,
// fenced blocks of known languages are rendered by plugin "fence" units.
import { Marked } from "marked";
import hljs from "highlight.js/lib/common";
import { esc, raw, type Raw } from "./html.ts";
import type { App } from "./types.ts";

const SAFE_URL = /^(https?:|mailto:|\/(?!\/)|#)/i;

/** Code with syntax colors for known languages (hljs-* classes, colored in product.css); plain escaped text otherwise. */
function highlight(text: string, lang?: string): string {
  const l = (lang ?? "").toLowerCase();
  if (!l || !hljs.getLanguage(l)) return esc(text);
  try { return hljs.highlight(text, { language: l, ignoreIllegals: true }).value; } catch { return esc(text); }
}

// chat text keeps single line breaks (people type that way); documents and files follow markdown (a newline is a space)
function makeMarked(app: App | null, breaks = true) {
  const m = new Marked({ gfm: true, breaks });
  m.use({
    renderer: {
      html({ text }) { return esc(text); },
      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        if (!href || !SAFE_URL.test(href)) return inner;
        return `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ""} target="_blank" rel="noopener noreferrer">${inner}</a>`;
      },
      image({ href, text }) {
        if (!href || !/^(https?:|data:image\/|\/files\/upl_[\w-]+$)/i.test(href)) return esc(text);
        return `<img src="${esc(href)}" alt="${esc(text)}" loading="lazy">`;
      },
      code({ text, lang }) {
        const fence = lang && app ? app.registry.fences.get(lang) : undefined;
        if (fence) {
          try { return fence.def.render(text).html; } catch { /* fall back to code */ }
        }
        // a shell command: ▶ runs it in the person's terminal (their Mac in the app, or a server of theirs) — their click
        const run = SHELL.test(lang ?? "") && text.trim() ? `<button type="button" class="md-btn md-run" data-act="md-run" aria-label="Run in terminal">${RUN}</button>` : "";
        return `<div class="md-code"><pre class="codeblock"><code${lang ? ` data-lang="${esc(lang)}" class="hljs"` : ""}>${highlight(text, lang)}</code></pre><span class="md-acts">${run}<button type="button" class="md-btn md-copy" data-act="md-copy" aria-label="Copy">${COPY}</button></span></div>`;
      },
    },
  });
  return m;
}

const icon = (d: string) => `<svg class="ic ic-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const SHELL = /^(sh|bash|zsh|shell|fish)$/i;
const RUN = icon('<path d="M7 4v16l13-8z"/>');
const COPY = icon('<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>');
const EXPAND = icon('<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>');
// a table scrolls sideways inside its frame; below it: open it full size, copy it (pastes as a table)
const TABLE_OPEN = `<div class="md-table"><div class="mt-scroll"><table>`;
const TABLE_CLOSE = `</table></div><div class="mt-foot"><button type="button" class="md-btn" data-act="md-expand" aria-label="Expand">${EXPAND}</button><span class="grow"></span><button type="button" class="md-btn" data-act="md-copy" aria-label="Copy">${COPY}</button></div></div>`;

const cache = new Map<string, { app: App | null; m: Marked }>();

function render(text: string, app: App | null, breaks: boolean): Raw {
  const key = breaks ? "chat" : "doc";
  let c = cache.get(key);
  if (!c || c.app !== app) { c = { app, m: makeMarked(app, breaks) }; cache.set(key, c); }
  return raw((c.m.parse(text ?? "", { async: false }) as string).replace(/<table>/g, TABLE_OPEN).replace(/<\/table>/g, TABLE_CLOSE));
}

/** Markdown of chat messages: single line breaks are kept. */
export function md(text: string, app: App | null = null): Raw {
  return render(text, app, true);
}

/** Markdown of documents and files: standard paragraphs (wrapped lines join), for canvases and the file viewer. */
export function mdDoc(text: string, app: App | null = null): Raw {
  return render(text, app, false);
}
