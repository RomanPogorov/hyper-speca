// An artboard file is a template: literal markup, plus data (one <script type="application/json" data-dc-data>),
// repeats (<dc-for each="topics" as="t" index="i">), branches (<dc-if test="t.mine">), holes ({{t.title}}) and
// components (<dc-import src="Card.html" title="{{t.title}}">, another artboard). The server renders it when it
// serves the frame. Every element carries the tid of its tag in the source (data-tid), so all copies a <dc-for> made
// share one tid (the repeat itself is only a pair of comment markers): selecting one highlights them all and a style edit (written to that one tag) changes them all.
// A copy also says which data item it came from (data-item), and a text made of holes carries its template source
// (data-tpl): editing a copy's text in place shows and edits the template, as in Claude Design; a copy's own values
// are edited as data (the panel's "Row data").
// so a person's edit of one copy edits its data. A component instance is one element (its root carries the
// import's tid); its insides are edited in the component's own artboard.
import { parse, attr, type El } from "./dom.ts";

type Val = { v: unknown; p: string | null };   // a value and its path in the data (null: not from the data)
type Scope = Record<string, Val>;
export type Files = Record<string, string>;

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const RAW = new Set(["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "plaintext"]);
const HOLE = /\{\{\s*([^{}]+?)\s*\}\}/g;
const escText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The data block of a file: its element and the parsed JSON ({} when there is none or it does not parse). */
export function dataOf(src: string, els = parse(src)): { el: El | null; data: Record<string, unknown> } {
  const el = els.find((e) => e.tag === "script" && attr(src, e, "data-dc-data") !== null) ?? null;
  if (!el) return { el: null, data: {} };
  try { const d = JSON.parse(src.slice(el.openEnd, el.closeStart)); return { el, data: d && typeof d === "object" && !Array.isArray(d) ? d : {} }; } catch { return { el, data: {} }; }
}

function resolve(expr: string, scope: Scope): Val {
  const segs = expr.trim().split(".").filter(Boolean);
  if (!segs.length) return { v: undefined, p: null };
  let cur: Val = scope[segs[0]!] ?? { v: undefined, p: null };
  for (const s of segs.slice(1)) {
    const v = cur.v as Record<string, unknown> | undefined;
    cur = { v: v == null ? undefined : s === "length" && Array.isArray(v) ? v.length : v[s], p: cur.p === null ? null : `${cur.p}.${s}` };
  }
  return cur;
}

/** dc-if tests: `a.b`, `!a.b`, `a.b == 'x'`, `a.b != 3` — no code runs. */
function truthy(test: string, scope: Scope): boolean {
  const t = test.trim();
  const m = /^(.+?)\s*(==|!=)\s*(.+)$/.exec(t);
  if (m) {
    const lit = m[3]!.trim(), want = /^(['"]).*\1$/.test(lit) ? lit.slice(1, -1) : lit === "true" ? true : lit === "false" ? false : Number.isFinite(Number(lit)) ? Number(lit) : resolve(lit, scope).v;
    const eq = resolve(m[1]!, scope).v == want;   // loose on purpose: "3" == 3
    return m[2] === "==" ? eq : !eq;
  }
  if (t.startsWith("!")) return !truthy(t.slice(1), scope);
  const v = resolve(t, scope).v;
  return Array.isArray(v) ? v.length > 0 : !!v;
}

const fill = (s: string, scope: Scope) => s.replace(HOLE, (_, e: string) => { const v = resolve(e, scope).v; return v == null ? "" : escText(typeof v === "object" ? JSON.stringify(v) : String(v)); });

/** Put attributes into a start tag (before its `>` or `/>`); `style` is merged into an existing one. */
function inject(open: string, add: Record<string, string>, style?: string): string {
  let o = open;
  if (style) {
    const m = /\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i.exec(o);
    if (m) { const cur = (m[2] ?? m[3] ?? "").trim().replace(/;\s*$/, ""); o = o.slice(0, m.index) + ` style="${cur ? `${cur}; ` : ""}${escText(style)}"` + o.slice(m.index + m[0].length); }
    else add = { ...add, style };
  }
  const tail = o.endsWith("/>") ? 2 : 1;
  return o.slice(0, o.length - tail).replace(/\s+$/, "") + Object.entries(add).map(([k, v]) => ` ${k}="${escText(v)}"`).join("") + o.slice(o.length - tail);
}

type Opts = { tids: boolean; depth: number; seen: Set<string>; root?: { add: Record<string, string>; style?: string } };

/** Render a file for its frame: every element numbered by its tag in the source, repeats and branches expanded,
 *  holes filled, components in place. `scope` adds values (a component's props). */
export function render(src: string, files: Files, scope?: Scope, opts: Opts = { tids: true, depth: 0, seen: new Set() }): string {
  const els = parse(src);
  const { data } = dataOf(src, els);
  const root: Scope = { ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, { v, p: k }])), ...scope };
  let rootLeft = opts.root;
  const out: string[] = [];

  const range = (from: number, to: number, kids: El[], sc: Scope, item: string | null) => {
    let at = from;
    for (const k of kids) { out.push(fill(src.slice(at, k.start), sc)); el(k, sc, item); at = k.end; }
    out.push(fill(src.slice(at, to), sc));
  };
  const el = (e: El, sc: Scope, item: string | null) => {
    const tid: Record<string, string> = opts.tids ? { "data-tid": String(e.tid) } : {};
    if (e.tag === "dc-for") {
      const list = resolve(attr(src, e, "each") ?? "", sc), as = attr(src, e, "as") || "item", index = attr(src, e, "index");
      const items = Array.isArray(list.v) ? list.v : [];
      // no element of its own (a wrapper would break the page's own CSS: "> div", ":nth-child"); the editor's
      // markers are comments
      if (opts.tids) out.push(`<!--dc:for ${e.tid} ${items.length}-->`);
      items.forEach((it, i) => {
        const s2: Scope = { ...sc, [as]: { v: it, p: list.p === null ? null : `${list.p}.${i}` } };
        if (index) s2[index] = { v: i, p: null };
        range(e.openEnd, e.closeStart, e.children, s2, s2[as]!.p);
      });
      if (opts.tids) out.push(`<!--/dc:for ${e.tid}-->`);
      return;
    }
    if (e.tag === "dc-if") {
      const on = truthy(attr(src, e, "test") ?? "", sc);
      if (opts.tids) out.push(`<!--dc:if ${e.tid} ${on ? "on" : "off"}-->`);
      if (on) range(e.openEnd, e.closeStart, e.children, sc, item);
      if (opts.tids) out.push(`<!--/dc:if ${e.tid}-->`);
      return;
    }
    // the first element of a component carries the instance (its tid, its style)
    // the editor's marks only where the editor looks (the frame); an export or a component's insides stay clean
    let add: Record<string, string> = { ...tid, ...(item && opts.tids ? { "data-item": item } : {}) }, style: string | undefined;
    if (rootLeft && !RAW.has(e.tag) && e.tag !== "dc-import") { add = { ...add, ...rootLeft.add }; style = rootLeft.style; rootLeft = undefined; }
    if (e.tag === "dc-import") return component(e, sc, add);
    if (!opts.tids && e.tag === "script" && attr(src, e, "data-dc-data") !== null) return;
    if (RAW.has(e.tag)) { out.push(inject(src.slice(e.start, e.openEnd), add, style) + src.slice(e.openEnd, e.end)); return; }
    const inner = src.slice(e.openEnd, e.closeStart);
    if (!e.children.length && opts.tids && inner.includes("{{")) add["data-tpl"] = inner.replace(/<br\s*\/?>/gi, "\n").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim();
    out.push(inject(fill(src.slice(e.start, e.openEnd), sc), add, style));
    if (VOID.has(e.tag) || e.openEnd === e.end) return;
    range(e.openEnd, e.closeStart, e.children, sc, null);
    out.push(src.slice(e.closeStart, e.end));
  };
  const component = (e: El, sc: Scope, add: Record<string, string>) => {
    const file = attr(src, e, "src") ?? "", body = files[file];
    const own = attr(src, e, "style") ?? undefined;
    if (body === undefined || opts.seen.has(file) || opts.depth > 4) {
      out.push(inject(`<div style="padding:8px 10px;border:1px dashed currentColor;opacity:.6;font:12px system-ui">`, add) + escText(body === undefined ? `${file} — no such artboard` : `${file} — imports itself`) + "</div>");
      return;
    }
    // props: every other attribute; a lone hole passes the value itself (an object, a list)
    const props: Scope = {};
    const open = src.slice(e.start, e.openEnd);
    for (const m of open.slice(1 + e.tag.length).matchAll(/([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      const k = m[1]!.toLowerCase(); if (k === "src" || k === "style" || k === "class") continue;
      const raw = m[2] ?? m[3] ?? m[4] ?? "", lone = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/.exec(raw);
      props[k] = lone ? { v: resolve(lone[1]!, sc).v, p: null } : { v: fill(raw, sc).replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"), p: null };
    }
    out.push(render(body, files, props, { tids: false, depth: opts.depth + 1, seen: new Set([...opts.seen, file]), root: { add: { ...add, ...(opts.tids ? { "data-import": file } : {}) }, style: own } }));
  };

  range(0, src.length, els.filter((e) => !e.parent), root, null);
  return out.join("");
}

/** The artboards a file imports, all the way down — what its frame shows depends on them too. */
export function importsOf(src: string, files: Files, seen = new Set<string>()): string[] {
  for (const e of parse(src)) {
    if (e.tag !== "dc-import") continue;
    const f = attr(src, e, "src");
    if (!f || seen.has(f) || files[f] === undefined) continue;
    seen.add(f); importsOf(files[f]!, files, seen);
  }
  return [...seen];
}

/** What a frame shows depends on: the file and every artboard it imports. A frame reloads when this changes. */
export function renderKey(file: string, files: Files): string {
  const src = files[file] ?? "";
  return Bun.hash([src, ...importsOf(src, files).map((x) => `${x}:${Bun.hash(files[x] ?? "").toString(36)}`)].join("\n")).toString(36);
}

// ── data edits: one copy of a repeat is one data item ──
const segs = (path: string) => path.split(".").map((s) => (/^\d+$/.test(s) ? Number(s) : s));
function at(data: unknown, path: (string | number)[]): unknown { let cur = data; for (const s of path) { if (cur == null || typeof cur !== "object") return undefined; cur = (cur as Record<string, unknown>)[s as string]; } return cur; }
// "<" escaped, so a value can never close the script it lives in
function writeData(src: string, el: El, data: unknown): string { return src.slice(0, el.openEnd) + "\n" + JSON.stringify(data, null, 2).replace(/</g, "\\u003c") + "\n" + src.slice(el.closeStart); }

/** Set one value of the data (a copy's text). */
export function setData(src: string, path: string, value: string): { html: string } | { error: string } {
  const { el, data } = dataOf(src);
  if (!el) return { error: "nodata" };
  const p = segs(path), parent = at(data, p.slice(0, -1)), cur = at(data, p);
  if (!parent || typeof parent !== "object" || cur === undefined || typeof cur === "object") return { error: "stale" };
  // keep the value's kind: a flag stays a flag, a number a number
  (parent as Record<string, unknown>)[p[p.length - 1] as string] = typeof cur === "boolean" ? value === "true" : typeof cur === "number" && Number.isFinite(Number(value)) && value.trim() !== "" ? Number(value) : value;
  return { html: writeData(src, el, data) };
}

/** Delete, duplicate or move one item of a list in the data (a copy of a repeat). Returns the item to select. */
export function itemOp(src: string, path: string, action: "delete" | "duplicate" | "up" | "down"): { html: string; item?: string } | { error: string } {
  const { el, data } = dataOf(src);
  if (!el) return { error: "nodata" };
  const p = segs(path), i = p[p.length - 1], list = at(data, p.slice(0, -1));
  if (!Array.isArray(list) || typeof i !== "number" || i >= list.length) return { error: "stale" };
  const base = p.slice(0, -1).join(".");
  if (action === "delete") { list.splice(i, 1); return { html: writeData(src, el, data) }; }
  if (action === "duplicate") { list.splice(i + 1, 0, structuredClone(list[i])); return { html: writeData(src, el, data), item: `${base}.${i + 1}` }; }
  const j = action === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= list.length) return { error: "edge" };
  [list[i], list[j]] = [list[j], list[i]];
  return { html: writeData(src, el, data), item: `${base}.${j}` };
}

/** A component instance as plain markup (its root keeps the instance's style) — for "Detach". */
export function detached(src: string, el: El, files: Files): string | null {
  const file = attr(src, el, "src") ?? "";
  if (files[file] === undefined) return null;
  const { data } = dataOf(src);
  const scope: Scope = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, { v, p: null }]));
  return render(`<dc-x>${src.slice(el.start, el.end)}</dc-x>`, files, scope, { tids: false, depth: 0, seen: new Set() }).replace(/^<dc-x>|<\/dc-x>$/g, "");
}
