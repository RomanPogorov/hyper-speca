// Speca's file viewer (plugins/file-viewer/file.canvas.ts) as the speca.file kind: one file of the chat's folder (or
// any path on this machine, or an SSH host) — markdown and HTML rendered with a View / Code switch, code and text,
// CSV as a table, JSON, images, PDF — with Open and Download. A file is not written on the canvas: no draft, no
// versions (like Speca's `asOf: false`), the tab shows the file as it is now.
import { stat, readFile } from "node:fs/promises";
import { html, join, raw, type Raw } from "./html.ts";
import { md, mdDoc } from "./md.ts";
import { ic } from "./ui/icons.ts";

const L = {
  en: { view: "View", code: "Code", download: "Download", open: "Open", gone: "This file is not available (deleted or moved).", noPreview: "No preview for this type of file.", big: "Too large to show here." },
  ru: { view: "Вид", code: "Код", download: "Скачать", open: "Открыть", gone: "Файл недоступен (удалён или перемещён).", noPreview: "Для такого типа файла нет предпросмотра.", big: "Слишком большой, чтобы показать здесь." },
};
const MAX_TEXT = 2_000_000;

type Kind = "markdown" | "html" | "svg" | "csv" | "json" | "code" | "text" | "image" | "pdf" | "other";

const EXT_LANG: Record<string, string> = { ts: "ts", tsx: "tsx", js: "js", mjs: "js", jsx: "jsx", py: "python", rb: "ruby", go: "go", rs: "rust", sh: "bash", sql: "sql", css: "css", yaml: "yaml", yml: "yaml", toml: "toml", xml: "xml", ini: "ini", json: "json", html: "html", htm: "html", md: "markdown", svg: "xml" };
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", ico: "image/x-icon", bmp: "image/bmp", svg: "image/svg+xml", pdf: "application/pdf", md: "text/markdown", csv: "text/csv", tsv: "text/tab-separated-values", json: "application/json", html: "text/html", htm: "text/html", txt: "text/plain", log: "text/plain" };

export function kindOf(name: string, mime = ""): Kind {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "md" || ext === "markdown" || mime === "text/markdown") return "markdown";
  if (ext === "html" || ext === "htm" || mime === "text/html") return "html";
  if (ext === "svg" || mime === "image/svg+xml") return "svg";
  if (mime.startsWith("image/")) return "image";
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (ext === "csv" || ext === "tsv" || mime === "text/csv") return "csv";
  if (ext === "json" || mime.includes("json")) return "json";
  if (EXT_LANG[ext]) return "code";
  if (mime.startsWith("text/") || ["txt", "log"].includes(ext)) return "text";
  return "other";
}

/** CSV/TSV → rows (quotes and escaped quotes; no multiline cells beyond quoted ones). */
export function parseCsv(text: string, sep = text.split("\n", 1)[0]!.includes("\t") ? "\t" : ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const fence = (lang: string, text: string) => {
  const ticks = "`".repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)));
  return md(`${ticks}${lang}\n${text}\n${ticks}`);
};

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

type Loaded = { name: string; mime: string; size: number; text: string | null; url: string };

/** The file as the viewer needs it: its text when it is text and not too large. */
async function load(ctx: Context, path: string, host: string | null): Promise<Loaded | null> {
  const name = path.split("/").filter(Boolean).pop() ?? path;
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const mime = MIME[ext] ?? "";
  const k = kindOf(name, mime);
  const textual = !["image", "pdf", "other"].includes(k);
  const url = `/files/raw?path=${encodeURIComponent(path)}${host ? `&host=${encodeURIComponent(host)}` : ""}`;
  if (host) {
    const st: any = await (ctx.fns as any).files.stat({ path, host }).catch(() => null);
    if (!st || st.isDir) return null;
    const text = textual && (st.size ?? 0) <= MAX_TEXT ? await (ctx.fns as any).files.read({ path, host }).catch(() => null) : null;
    return { name, mime, size: Number(st.size ?? 0), text, url };
  }
  const st = await stat(path).catch(() => null);
  if (!st || !st.isFile()) return null;
  let text: string | null = null;
  if (textual && st.size <= MAX_TEXT) {
    const b = await readFile(path);
    text = b.subarray(0, 8000).includes(0) ? null : b.toString("utf8");
  }
  return { name, mime, size: st.size, text, url };
}

/** The viewer: the header line (name, type and size, View / Code, Open, Download) and the file. */
export async function fileViewer(ctx: Context, o: { tabId: number; path: string; host: string | null; view?: string; locale: string }): Promise<Raw> {
  const l = L[o.locale === "ru" ? "ru" : "en"];
  const f = await load(ctx, o.path, o.host);
  const head = (extra: Raw | string) => html`<div class="doc-h"><span class="path"><span class="kind-ic" aria-hidden="true">${ic("file", "ic-sm tico")}</span>${f?.name ?? o.path.split("/").pop()}</span><span class="grow"></span>${extra}</div>`;
  if (!f) return html`<div class="doc fvw-doc">${head("")}<div class="tab-content"><div class="fvw"><div class="fvw-empty">${ic("file")}<span>${l.gone}</span></div></div></div></div>`;
  const kind = kindOf(f.name, f.mime);
  const ext = f.name.toLowerCase().split(".").pop() ?? "";
  const text = f.text;
  const switchable = text !== null && (kind === "markdown" || kind === "html" || kind === "svg" || kind === "csv" || kind === "json");
  const radio = `fvw-${o.tabId}`;
  const first = o.view === "code" ? "code" : "view";
  const extra = html`<span class="fvw-meta">${ext.toUpperCase()} · ${size(f.size)}</span>
    ${switchable ? html`<span class="fvw-sw" role="radiogroup" aria-label="${l.view} / ${l.code}">
      <input type="radio" class="fvw-r-view" name="${radio}" id="${radio}-v" ${first === "view" ? raw("checked") : ""}><label for="${radio}-v" data-v="view">${l.view}</label>
      <input type="radio" class="fvw-r-code" name="${radio}" id="${radio}-c" ${first === "code" ? raw("checked") : ""}><label for="${radio}-c" data-v="code">${l.code}</label></span>` : ""}
    <a class="btn fvw-act" data-variant="ghost" data-size="icon-sm" href="${f.url}" target="_blank" rel="noopener" aria-label="${l.open}" data-tooltip="${l.open}" data-side="bottom">${ic("arrowUR", "ic-sm")}</a>
    <a class="btn fvw-act" data-variant="ghost" data-size="icon-sm" href="${f.url}" download="${f.name}" aria-label="${l.download}" data-tooltip="${l.download}" data-side="bottom" data-align="end">${ic("download", "ic-sm")}</a>`;

  let view: Raw;
  if (kind === "image" || kind === "svg") view = html`<div class="fvw-body"><img class="fvw-img" src="${f.url}" alt="${f.name}"></div>`;
  else if (kind === "pdf") view = html`<div class="fvw-body flush"><iframe class="fvw-frame" src="${f.url}" title="${f.name}"></iframe></div>`;
  else if (kind === "html" && text !== null) view = html`<div class="fvw-body flush"><iframe class="fvw-frame" sandbox="" srcdoc="${text}" title="${f.name}"></iframe></div>`;
  else if (kind === "markdown" && text !== null) view = html`<div class="fvw-body"><article class="md prose">${mdDoc(text)}</article></div>`;
  else if (kind === "csv" && text !== null) {
    const [hd, ...body] = parseCsv(text).slice(0, 2000);
    view = html`<div class="fvw-body flush"><div class="tbl-wrap"><table class="grid"><thead><tr>${join((hd ?? []).map((c) => html`<th>${c}</th>`))}</tr></thead><tbody>${join(body.map((r) => html`<tr>${join(r.map((c) => html`<td>${c}</td>`))}</tr>`))}</tbody></table></div></div>`;
  } else if (kind === "json" && text !== null) {
    let pretty = text;
    try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* show as is */ }
    view = html`<div class="fvw-body">${fence("json", pretty)}</div>`;
  } else if ((kind === "code" || kind === "text") && text !== null) view = html`<div class="fvw-body">${fence(EXT_LANG[ext] ?? "", text)}</div>`;
  else view = html`<div class="fvw-body"><div class="fvw-empty">${ic("file")}<span>${text === null && kind !== "other" ? l.big : l.noPreview}</span><a class="btn" data-size="sm" href="${f.url}" download="${f.name}">${ic("download", "ic-sm")}${l.download}</a></div></div>`;

  const code = switchable ? html`<div class="fvw-body fvw-code">${fence(kind === "csv" ? "" : kind === "svg" ? "xml" : EXT_LANG[ext] ?? kind, text!)}</div>` : "";
  return html`<div class="doc fvw-doc">${head(extra)}<div class="tab-content"><div class="fvw">${switchable ? html`<div class="fvw-view">${view}</div>${code}` : view}</div></div></div>`;
}

/** Where a path the agent gave points: absolute, or relative to its workspace (a remote workspace: on its host). */
export async function resolveFor(ctx: Context, agentId: string, path: string, asked?: string): Promise<{ path: string; host: string | null }> {
  const ws = ((await ctx.fns.procs.db.select({ sql: "SELECT workspace_dir, workspace_host FROM agents WHERE id = ?", params: [agentId] })) as any[])[0] ?? {};
  const host = String(asked ?? "").trim() || String(ws.workspace_host ?? "").trim() || null;
  const home = process.env.HOME ?? "~";
  const p = path.replace(/^~(?=\/|$)/, host ? "~" : home);
  if (p.startsWith("/") || p.startsWith("~")) return { path: p, host };
  const base = String(ws.workspace_dir ?? "").replace(/^~(?=\/|$)/, host ? "~" : home).replace(/\/+$/, "");
  if (!base) throw new Error(`speca.file: "${path}" is relative and the chat has no folder — give an absolute path`);
  return { path: `${base}/${p.replace(/^\.\//, "")}`, host };
}
