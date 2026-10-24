// Speca's canvas kit as Hyper canvas kinds (speca.doc, speca.table, speca.chart, speca.metrics, speca.list,
// speca.board, speca.compare): the content is the tab's args (versioned, compared and commented like any tab),
// drawn in place with Speca's styles. Each `$canvas_<name>.ts` of the plugin is a thin wrapper of one entry here.
import { html, join, raw, esc, type Raw } from "./html.ts";
import { mdDoc } from "./md.ts";
import { ic } from "./ui/icons.ts";

type Args = Record<string, any>;
type Item = { id: number; agentId?: string; kind: string; title: string; args: Args; state?: Args };
type Opts = { agentId: string; item: Item; ui?: { t: { locale: string } } };

const fail = (kind: string, msg: string): never => { throw new Error(`canvas speca.${kind}: ${msg}`); };
const str = (v: unknown) => typeof v === "string";
const optStr = (v: unknown) => v === undefined || typeof v === "string";

// ---------- doc ----------
export const doc = {
  icon: "file-text",
  hint: "a markdown document — args `{ markdown }`; every change goes to the draft, the person edits it in place, saves versions and compares them; change parts with canvas.edit (field markdown)",
  prepare(_ctx: Context, o: { args: Args }) {
    const markdown = o.args.markdown ?? o.args.text ?? "";
    if (!str(markdown)) fail("doc", "args.markdown must be a string");
    const h1 = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim();
    return { args: { markdown }, ...(h1 ? { title: h1.slice(0, 80) } : {}) };
  },
  render(_ctx: Context, o: Opts) {
    return String(html`<article class="canvas-doc md prose">${mdDoc(String(o.item.args.markdown ?? ""))}</article>`);
  },
  describe(_ctx: Context, o: { item: Item }) {
    const m = String(o.item.args.markdown ?? "");
    return `markdown document, ${m.split("\n").length} lines — read it with canvas.tab, change it with canvas.edit (field markdown) or canvas.write`;
  },
};

// ---------- table ----------
type Cell = string | number | null | { text: string; tone?: "ok" | "bad" | "muted" | "pill" };
export const table = {
  icon: "table",
  hint: "a table — args `{ columns: [names], rows: [[cells]], note?, align?: [\"l\"|\"r\" per column] }`; a cell is a string, a number or `{ text, tone: ok|bad|muted|pill }`",
  prepare(_ctx: Context, o: { args: Args }) {
    const { columns, rows = [], note, align } = o.args;
    if (!Array.isArray(columns) || !columns.length || !columns.every(str)) fail("table", "args.columns must be a non-empty list of names");
    if (!Array.isArray(rows) || !rows.every(Array.isArray)) fail("table", "args.rows must be a list of rows (lists of cells)");
    for (const r of rows as unknown[][]) for (const c of r) {
      if (c === null || str(c) || typeof c === "number") continue;
      if (typeof c === "object" && str((c as any).text) && [undefined, "ok", "bad", "muted", "pill"].includes((c as any).tone)) continue;
      fail("table", `a cell must be a string, a number, null or {text, tone}: ${JSON.stringify(c).slice(0, 80)}`);
    }
    if (!optStr(note)) fail("table", "args.note must be a string");
    if (align !== undefined && (!Array.isArray(align) || !align.every((a) => a === "l" || a === "r"))) fail("table", "args.align must be a list of \"l\" or \"r\"");
    return { args: { columns, rows, ...(note ? { note } : {}), ...(align ? { align } : {}) } };
  },
  render(_ctx: Context, o: Opts) { return String(tableHtml(o.item.args)); },
  describe(_ctx: Context, o: { item: Item }) {
    return `table: ${(o.item.args.columns ?? []).join(" | ")} — ${(o.item.args.rows ?? []).length} rows`;
  },
};
function tableHtml(s: Args): Raw {
  const al = (i: number) => (s.align?.[i] === "r" ? "r" : "");
  const cell = (c: Cell, i: number) => {
    if (c && typeof c === "object") return c.tone === "pill" ? html`<td class="${al(i)}"><span class="pill">${c.text}</span></td>` : html`<td class="${al(i)} tone-${c.tone ?? ""}">${c.text}</td>`;
    return html`<td class="${al(i)}">${c ?? ""}</td>`;
  };
  const rows: Cell[][] = s.rows ?? [];
  return html`<div class="tbl-wrap">${s.note ? html`<div class="tbl-note">${s.note}</div>` : ""}<table class="grid"><thead><tr>${join((s.columns ?? []).map((c: string, i: number) => html`<th class="${al(i)}">${c}</th>`))}</tr></thead>
    <tbody>${join(rows.map((r) => html`<tr>${join(r.map(cell))}</tr>`))}</tbody></table>${!rows.length ? html`<div class="empty-line">—</div>` : ""}</div>`;
}

// ---------- metrics ----------
export const metrics = {
  icon: "gauge",
  hint: "stat tiles — args `{ items: [{ label, value, sub?, tone?: ok|bad }] }` (1–12), e.g. sold 612 / 900",
  prepare(_ctx: Context, o: { args: Args }) {
    const items = o.args.items;
    if (!Array.isArray(items) || !items.length || items.length > 12) fail("metrics", "args.items must hold 1 to 12 tiles");
    for (const i of items) if (!str(i?.label) || !(str(i?.value) || typeof i?.value === "number") || !optStr(i.sub) || ![undefined, "ok", "bad"].includes(i.tone)) fail("metrics", `a tile is {label, value, sub?, tone?: ok|bad}: ${JSON.stringify(i).slice(0, 80)}`);
    return { args: { items } };
  },
  render(_ctx: Context, o: Opts) { return String(metricsHtml(o.item.args)); },
  describe(_ctx: Context, o: { item: Item }) {
    return `metrics: ${(o.item.args.items ?? []).map((i: any) => `${i.label} ${i.value}${i.sub ? ` ${i.sub}` : ""}`).join("; ")}`;
  },
};
const metricsHtml = (s: Args) => html`<div class="kpis">${join((s.items ?? []).map((i: any) => html`<div class="kpi ${i.tone ?? ""}"><div class="kl">${i.label}</div><div class="kv">${String(i.value)}${i.sub ? html`<small> ${i.sub}</small>` : ""}</div></div>`))}</div>`;

// ---------- list ----------
export const list = {
  icon: "list-checks",
  hint: "a list — args `{ items: [{ title, meta?, href?, done?, icon? }], empty? }`: links, findings, a checklist (done true/false draws a check box)",
  prepare(_ctx: Context, o: { args: Args }) {
    const { items = [], empty } = o.args;
    if (!Array.isArray(items)) fail("list", "args.items must be a list");
    for (const i of items) if (!str(i?.title) || !optStr(i.meta) || !optStr(i.href) || !optStr(i.icon) || ![undefined, true, false].includes(i.done)) fail("list", `an item is {title, meta?, href?, done?, icon?}: ${JSON.stringify(i).slice(0, 80)}`);
    if (!optStr(empty)) fail("list", "args.empty must be a string");
    return { args: { items, ...(empty ? { empty } : {}) } };
  },
  render(_ctx: Context, o: Opts) { return String(listHtml(o.item.args)); },
  describe(_ctx: Context, o: { item: Item }) {
    const it = o.item.args.items ?? [];
    const done = it.filter((i: any) => i.done).length;
    return `list of ${it.length} items${it.some((i: any) => i.done !== undefined) ? `, ${done} done` : ""}`;
  },
};
function listHtml(s: Args): Raw {
  const items: any[] = s.items ?? [];
  if (!items.length) return html`<div class="empty-line">${s.empty ?? "—"}</div>`;
  return html`<div class="dlist">${join(items.map((i) => html`<div class="ditem ${i.done ? "done" : ""}">${i.icon ? ic(i.icon, "ic-sm") : i.done !== undefined ? html`<span class="dchk" aria-pressed="${!!i.done}">${ic("check", "ic-xs")}</span>` : ""}<div class="grow"><div class="dt">${i.href && /^https?:/.test(i.href) ? html`<a href="${i.href}" target="_blank" rel="noopener noreferrer">${i.title}</a>` : i.title}</div>${i.meta ? html`<div class="dm">${i.meta}</div>` : ""}</div></div>`))}</div>`;
}

// ---------- chart ----------
type Series = { name: string; values: Array<number | null>; style?: "solid" | "dashed" | "muted" | "accent" };
const STROKE: Record<string, string> = { solid: "var(--foreground)", dashed: "var(--fg-2)", muted: "var(--fg-3)", accent: "var(--signal)" };
function nice(max: number): number {
  if (max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= max) return m * p;
  return 10 * p;
}
/** A server-drawn SVG chart: one visual language, colour only for meaning. */
export function svgChart(s: { type: "line" | "bar"; labels: string[]; series: Series[]; unit?: string; title?: string }): string {
  const W = 640, H = 260, L = 44, R = 12, T = 14, B = 34;
  const all = s.series.flatMap((x) => x.values.filter((v): v is number => v !== null));
  const tick = nice(Math.max(0, ...all) / 4);
  const top = tick * 4;
  const n = Math.max(1, s.labels.length);
  const x = (i: number) => L + (s.type === "bar" ? ((i + 0.5) * (W - L - R)) / n : n === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  let out = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(s.title ?? "chart")}">`;
  for (let k = 0; k <= 4; k++) {
    const v = tick * k;
    out += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end" font-size="10" fill="var(--fg-3)">${+v.toFixed(2)}${esc(s.unit ?? "")}</text>`;
  }
  const step = Math.ceil(n / 8);
  s.labels.forEach((l, i) => { if (i % step === 0 || i === n - 1) out += `<text x="${x(i)}" y="${H - B + 16}" text-anchor="middle" font-size="10" fill="var(--fg-3)">${esc(l)}</text>`; });
  if (s.type === "bar") {
    const k = s.series.length;
    const bw = Math.max(4, ((W - L - R) / n) * 0.7 / k);
    s.series.forEach((sr, si) => sr.values.forEach((v, i) => {
      if (v === null) return;
      const cx = x(i) - (bw * k) / 2 + si * bw;
      out += `<rect x="${cx}" y="${y(v)}" width="${bw - 1}" height="${y(0) - y(v)}" rx="2" fill="${STROKE[sr.style ?? (si ? "muted" : "solid")]}"><title>${esc(sr.name)}: ${v}</title></rect>`;
    }));
  } else {
    s.series.forEach((sr, si) => {
      const style = sr.style ?? (si === 0 ? "solid" : si === 1 ? "dashed" : "muted");
      const pts = sr.values.map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`));
      const segs: string[][] = [[]];
      for (const p of pts) { if (p) segs[segs.length - 1]!.push(p); else segs.push([]); }
      for (const seg of segs) if (seg.length) out += `<polyline points="${seg.join(" ")}" fill="none" stroke="${STROKE[style]}" stroke-width="${style === "solid" ? 2 : 1.5}" ${style === "dashed" ? 'stroke-dasharray="5 4"' : ""} stroke-linejoin="round" stroke-linecap="round"/>`;
      const lastI = sr.values.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0).pop();
      if (lastI !== undefined && si === 0) out += `<circle cx="${x(lastI)}" cy="${y(sr.values[lastI]!)}" r="3.5" fill="var(--foreground)"/><text x="${x(lastI)}" y="${y(sr.values[lastI]!) - 8}" text-anchor="middle" font-size="10.5" font-weight="600" fill="var(--foreground)">${sr.values[lastI]}</text>`;
    });
  }
  out += `</svg><div class="chart-legend">${s.series.map((sr, si) => `<span><i class="lg ${sr.style ?? (s.type === "bar" ? (si ? "muted" : "solid") : si === 0 ? "solid" : si === 1 ? "dashed" : "muted")}"></i>${esc(sr.name)}</span>`).join("")}</div>`;
  return out;
}
const chartHtml = (s: Args) => raw(`<figure class="chart-wrap">${s.title ? `<figcaption class="chart-t">${esc(s.title)}</figcaption>` : ""}${svgChart(s as any)}</figure>`);
export const chart = {
  icon: "chart-line",
  hint: "a line or bar chart — args `{ type: line|bar, labels: [x labels], series: [{ name, values: [numbers or null], style?: solid|dashed|muted|accent }], unit?, title? }`; few series, colour only for meaning",
  prepare(_ctx: Context, o: { args: Args }) {
    const { type = "line", labels, series, unit, title } = o.args;
    if (type !== "line" && type !== "bar") fail("chart", "args.type is line or bar");
    if (!Array.isArray(labels) || !labels.every(str)) fail("chart", "args.labels must be a list of strings");
    if (!Array.isArray(series) || !series.length || series.length > 6) fail("chart", "args.series must hold 1 to 6 series");
    for (const sr of series) if (!str(sr?.name) || !Array.isArray(sr.values) || !sr.values.every((v: unknown) => v === null || typeof v === "number") || ![undefined, "solid", "dashed", "muted", "accent"].includes(sr.style)) fail("chart", `a series is {name, values: [numbers or null], style?}: ${JSON.stringify(sr).slice(0, 80)}`);
    if (!optStr(unit) || !optStr(title)) fail("chart", "args.unit and args.title are strings");
    return { args: { type, labels, series, ...(unit ? { unit } : {}), ...(title ? { title } : {}) }, ...(title ? { title } : {}) };
  },
  render(_ctx: Context, o: Opts) { return String(chartHtml(o.item.args)); },
  describe(_ctx: Context, o: { item: Item }) {
    const a = o.item.args;
    return `${a.type} chart${a.title ? ` "${a.title}"` : ""}: ${(a.series ?? []).map((s: any) => s.name).join(", ")} over ${(a.labels ?? []).length} points`;
  },
};

// ---------- board ----------
/** Bodies a board can hold: the kit's own kinds (by short name or speca.<name>). */
const BLOCKS: Record<string, { title: Record<string, string>; draw: (a: Args) => Raw }> = {
  doc: { title: { en: "Document", ru: "Документ" }, draw: (a) => html`<article class="canvas-doc md prose">${mdDoc(String(a.markdown ?? ""))}</article>` },
  table: { title: { en: "Table", ru: "Таблица" }, draw: tableHtml },
  chart: { title: { en: "Chart", ru: "График" }, draw: chartHtml },
  metrics: { title: { en: "Metrics", ru: "Метрики" }, draw: metricsHtml },
  list: { title: { en: "List", ru: "Список" }, draw: listHtml },
};
const blockOf = (kind: string) => BLOCKS[String(kind).replace(/^(speca|canvas-kit)\./, "")];
const ru = (o: Opts) => (o.ui?.t.locale ?? "en") === "ru";
export const board = {
  icon: "layout",
  hint: "a board of blocks — args `{ columns?: 1-3, blocks: [{ kind: doc|table|chart|metrics|list, title?, state: that kind's args, span?: 1-3 }] }` (1–24 blocks): a dashboard composed of the kit's kinds",
  prepare(_ctx: Context, o: { args: Args }) {
    const { columns, blocks } = o.args;
    if (columns !== undefined && ![1, 2, 3].includes(columns)) fail("board", "args.columns is 1, 2 or 3");
    if (!Array.isArray(blocks) || !blocks.length || blocks.length > 24) fail("board", "args.blocks must hold 1 to 24 blocks");
    const out = blocks.map((b: any) => {
      const short = String(b?.kind ?? "").replace(/^(speca|canvas-kit)\./, "");
      if (!BLOCKS[short]) fail("board", `a block's kind is one of ${Object.keys(BLOCKS).join(", ")}: ${b?.kind}`);
      const st = b.state ?? b.args ?? {};
      const k = { doc, table, chart, metrics, list }[short as "doc"];
      const ok = k.prepare(_ctx, { args: st }).args;
      return { kind: short, ...(b.title ? { title: String(b.title) } : {}), state: ok, ...([1, 2, 3].includes(b.span) ? { span: b.span } : {}) };
    });
    return { args: { ...(columns ? { columns } : {}), blocks: out } };
  },
  render(_ctx: Context, o: Opts) {
    const s = o.item.args;
    const cols = s.columns ?? 2;
    const cells = (s.blocks ?? []).map((b: any) => {
      const k = blockOf(b.kind);
      const body = k ? k.draw(b.state ?? {}) : html`<div class="empty-line">${b.kind}</div>`;
      const title = b.title ?? (k ? k.title[ru(o) ? "ru" : "en"] : b.kind);
      return html`<section class="bblock" style="grid-column: span ${Math.min(b.span ?? 1, cols)}"><header class="bblock-h">${title}</header><div class="bblock-b">${body}</div></section>`;
    });
    return String(html`<div class="boardx" style="--cols:${cols}">${join(cells)}</div>`);
  },
  describe(_ctx: Context, o: { item: Item }) {
    return `board of ${(o.item.args.blocks ?? []).length} blocks: ${(o.item.args.blocks ?? []).map((b: any) => b.title ?? b.kind).join(", ")}`;
  },
};

// ---------- compare ----------
const CL = {
  en: { pick: "Choose this one", open: "Open", missing: "This tab is closed" },
  ru: { pick: "Выбрать этот", open: "Открыть", missing: "Эта вкладка закрыта" },
};
/** Kinds drawn in place inside a comparison (the rest go into their frame page). */
const IN_PLACE: Record<string, (a: Args) => Raw> = {
  "speca.doc": BLOCKS.doc!.draw, "speca.table": tableHtml, "speca.chart": chartHtml, "speca.metrics": metricsHtml, "speca.list": listHtml,
};
export const compare = {
  icon: "squares-four",
  hint: "variants side by side — args `{ items: [{ tabId, label, note? }] }` (2–6 tabs of this chat made from one brief in different styles; label = what each was made with); the person picks one with «Choose this one» and the choice comes to you as their message",
  async prepare(ctx: Context, o: { agentId: string; args: Args }) {
    const items = o.args.items;
    if (!Array.isArray(items) || items.length < 2 || items.length > 6) fail("compare", "args.items must hold 2 to 6 tabs");
    const out = [];
    for (const it of items) {
      const id = Number(it?.tabId);
      if (!Number.isInteger(id) || !str(it.label) || !optStr(it.note)) fail("compare", `an item is {tabId, label, note?}: ${JSON.stringify(it).slice(0, 80)}`);
      const tab = await ctx.fns.canvas.tab({ itemId: id, agentId: o.agentId }).catch(() => null);
      if (!tab) fail("compare", `tab ${id} is not on this chat's canvas`);
      out.push({ tabId: id, label: String(it.label).slice(0, 80), ...(it.note ? { note: String(it.note).slice(0, 200) } : {}) });
    }
    return { args: { items: out } };
  },
  async render(ctx: Context, o: Opts) {
    const l = CL[ru(o) ? "ru" : "en"];
    const items: Array<{ tabId: number; label: string; note?: string }> = o.item.args.items ?? [];
    const cells = await Promise.all(items.map(async (it) => {
      const tab: Item | null = await ctx.fns.canvas.tab({ itemId: it.tabId, agentId: o.agentId }).catch(() => null);
      const draw = tab ? IN_PLACE[tab.kind] : undefined;
      const body = !tab ? html`<div class="cmp-missing">${l.missing}</div>`
        : draw ? html`<div class="cmp-doc">${draw(tab.args)}</div>`
        : html`<iframe class="cmp-frame" src="/speca/s/${o.agentId}/tab/${tab.id}/frame" title="${it.label}"></iframe>`;
      return html`<figure class="cmp-cell"><figcaption><b>${it.label}</b>${it.note ? html`<small>${it.note}</small>` : ""}</figcaption>${body}
        <div class="cmp-acts">${tab ? html`<button class="btn" data-variant="ghost" data-size="sm" hx-post="/speca/canvas/${tab.id}/activate" hx-swap="none">${l.open}</button><button class="btn" data-size="sm" hx-post="/speca/canvas/${o.item.id}/choose" hx-vals='${JSON.stringify({ tabId: tab.id, label: it.label })}' hx-swap="none">${l.pick}</button>` : ""}</div></figure>`;
    }));
    return String(html`<div class="cmp-grid" style="--n:${Math.min(items.length, 3)}">${join(cells)}</div>`);
  },
  describe(_ctx: Context, o: { item: Item }) {
    return `comparison of ${(o.item.args.items ?? []).map((i: any) => `"${i.label}" (tab ${i.tabId})`).join(", ")} — the person picks one`;
  },
};
