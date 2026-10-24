// "Make a repeat": hand-written copies (cards, rows, tabs drawn one by one) become one template and data. The run of
// siblings that look like the chosen element (same tag, class and style) is merged into one tag tree: what all
// copies share stays literal, a text or attribute that differs becomes a hole filled from the item's data, and a
// child only some copies have becomes a branch (<dc-if>) — the dark "2" and the light "+" button of a menu card turn
// into two branches. Then selecting one copy selects all of them, as for any repeat.
import { parse, attr, parseStyle, type El } from "./dom.ts";
import { dataOf } from "./template.ts";

type Node = { el: El; tag: string; attrs: Array<[string, string | null]>; kids: Node[]; texts: string[]; selfClose: boolean };
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const VARY = new Set(["href", "src", "alt", "aria-label", "title", "placeholder", "value", "datetime"]);
const attrRe = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const norm = (s: string | null) => (s ?? "").replace(/\s+/g, " ").replace(/\s*;\s*$/, "").trim();

function nodeOf(src: string, el: El): Node {
  const open = src.slice(el.start, el.openEnd);
  const attrs: Array<[string, string | null]> = [];
  attrRe.lastIndex = 1 + el.tag.length;
  for (let m; (m = attrRe.exec(open)); ) { if (m[1] === "/") continue; attrs.push([m[1]!.toLowerCase(), m[2] ?? m[3] ?? m[4] ?? null]); }
  const texts: string[] = [];
  let at = el.openEnd;
  for (const c of el.children) { texts.push(src.slice(at, c.start)); at = c.end; }
  texts.push(src.slice(at, el.closeStart));
  return { el, tag: el.tag, attrs, kids: el.children.map((c) => nodeOf(src, c)), texts, selfClose: open.endsWith("/>") };
}
/** What makes two elements "the same thing": tag, class and style. */
export const signature = (src: string, el: El) => `${el.tag}|${norm(attr(src, el, "class")).split(" ").sort().join(" ")}|${canon(attr(src, el, "style"))}`;
/** A style as its declarations, sorted: the same look written in another order or spacing is the same. */
export const canon = (s: string | null) => parseStyle(unesc(s ?? "")).map(([k, v]) => `${k}:${v.replace(/\s+/g, " ")}`).sort().join(";");
// inside a copy, parts line up by tag and class; a style that differs between copies becomes data (below)
const sig = (n: Node) => `${n.tag}|${norm(n.attrs.find(([k]) => k === "class")?.[1] ?? null).split(" ").sort().join(" ")}`;

/** The siblings around `el` (contiguous, whitespace and comments between allowed) that share its signature. */
export function runOf(src: string, els: El[], el: El): El[] {
  const sibs = el.parent ? el.parent.children : els.filter((e) => !e.parent);
  const s = signature(src, el), i = sibs.indexOf(el);
  let a = i, b = i;
  while (a > 0 && signature(src, sibs[a - 1]!) === s) a--;
  while (b < sibs.length - 1 && signature(src, sibs[b + 1]!) === s) b++;
  return sibs.slice(a, b + 1);
}

// one sequence of keys holding all the given ones in order (progressive LCS); maps[i][j] = where seqs[i][j] went
function union(seqs: string[][]): { keys: string[]; maps: number[][] } {
  let keys = [...seqs[0]!], maps = [seqs[0]!.map((_, j) => j)];
  for (const s of seqs.slice(1)) {
    const n = keys.length, m = s.length, L = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i]![j] = keys[i] === s[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
    const merged: string[] = [], fromU: number[] = [], fromS: number[] = [];
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && keys[i] === s[j]) { fromU[i] = fromS[j] = merged.length; merged.push(keys[i]!); i++; j++; }
      else if (j >= m || (i < n && L[i + 1]![j]! >= L[i]![j + 1]!)) { fromU[i] = merged.length; merged.push(keys[i]!); i++; }
      else { fromS[j] = merged.length; merged.push(s[j]!); j++; }
    }
    maps = maps.map((mp) => mp.map((x) => fromU[x]!));
    maps.push(s.map((_, k) => fromS[k]!));
    keys = merged;
  }
  return { keys, maps };
}

type Ctx = { fields: Map<string, number>; values: Array<Record<string, string | boolean>>; as: string; branches: number };
const field = (ctx: Ctx, base: string) => { const n = (ctx.fields.get(base) ?? 0) + 1; ctx.fields.set(base, n); return n === 1 ? base : `${base}${n}`; };
const PRICE = /[₽$€£¥]|\b(руб|USD|EUR)\b/i;
const textName = (ctx: Ctx, n: Node, vals: string[]) => {
  if (vals.some((v) => PRICE.test(v))) return field(ctx, "price");
  if (vals.every((v) => /^\s*\d{1,3}\s*$/.test(v))) return field(ctx, "count");
  if (/^h[1-6]$/.test(n.tag) || !ctx.fields.has("title")) return field(ctx, "title");
  if (!ctx.fields.has("subtitle")) return field(ctx, "subtitle");
  return field(ctx, "text");
};

// the declarations every copy shares stay; one that differs reads its value from the item ("background: {{it.background}}")
function mergeStyle(styles: string[], rows: number[], ctx: Ctx): string {
  const decls = styles.map((st) => new Map(parseStyle(unesc(st))));
  const props: string[] = [];
  for (const d of decls) for (const p of d.keys()) if (!props.includes(p)) props.push(p);
  return esc(props.map((p) => {
    const vals = decls.map((d) => d.get(p) ?? "");
    if (vals.every((v) => v === vals[0])) return `${p}: ${vals[0]}`;
    const f = field(ctx, p.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()));
    rows.forEach((r, i) => { ctx.values[r]![f] = vals[i]!; });
    return `${p}: {{${ctx.as}.${f}}}`;
  }).join("; "));
}

// merge elements of one signature (rows = which items each one belongs to) into one template tag
function merge(src: string, ns: Node[], rows: number[], ctx: Ctx): string | null {
  const raw = ns.map((n) => src.slice(n.el.start, n.el.end));
  if (raw.every((r) => r === raw[0])) return raw[0]!;   // the same everywhere: keep it as written
  const a0 = ns[0]!;
  // attributes: shared → literal; a varying text-ish one → a hole; varying style or class cannot be (signature)
  const names: string[] = [];
  for (const n of ns) for (const [k] of n.attrs) if (!names.includes(k)) names.push(k);
  const parts: string[] = [];
  for (const k of names) {
    const vals = ns.map((n) => n.attrs.find(([x]) => x === k));
    if (vals.every((v) => v && v[1] === vals[0]![1])) { parts.push(vals[0]![1] === null ? k : `${k}="${vals[0]![1]}"`); continue; }
    if (k === "style") { parts.push(`style="${mergeStyle(ns.map((n) => n.attrs.find(([x]) => x === k)?.[1] ?? ""), rows, ctx)}"`); continue; }
    if (!VARY.has(k) && !k.startsWith("aria-") && !k.startsWith("data-")) return null;
    const f = field(ctx, k.replace(/^aria-|^data-/, "").replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()));
    ns.forEach((n, i) => { ctx.values[rows[i]!]![f] = unesc(n.attrs.find(([x]) => x === k)?.[1] ?? ""); });
    parts.push(`${k}="{{${ctx.as}.${f}}}"`);
  }
  const open = `<${a0.tag}${parts.length ? " " + parts.join(" ") : ""}${a0.selfClose ? " /" : ""}>`;
  if (VOID.has(a0.tag) || a0.selfClose) return open;
  const close = `</${a0.tag}>`;
  // children line up by tag; the text around them is a slot each: the same in every copy → literal, else a hole
  const u = union(ns.map((n) => n.kids.map(sig)));
  const slot = (i: number, p: number) => { const j = p < u.keys.length ? u.maps[i]!.indexOf(p) : ns[i]!.kids.length; return j >= 0 ? ns[i]!.texts[j]! : ""; };
  const text = (p: number) => {
    const vals = ns.map((_, i) => slot(i, p));
    if (vals.every((v) => v.trim() === vals[0]!.trim())) return vals[0]!;
    const f = textName(ctx, a0, vals.map(unesc));
    ns.forEach((_, i) => { ctx.values[rows[i]!]![f] = unesc(vals[i]!.trim()); });
    const v0 = vals.find((v) => v.trim()) ?? "";
    return `${/^\s*/.exec(v0)![0]}{{${ctx.as}.${f}}}${/\s*$/.exec(v0)![0]}`;
  };
  const out: string[] = [];
  for (let p = 0; p < u.keys.length; p++) {
    out.push(text(p));
    const has: Node[] = [], hasRows: number[] = [];
    ns.forEach((n, i) => { const j = u.maps[i]!.indexOf(p); if (j >= 0) { has.push(n.kids[j]!); hasRows.push(rows[i]!); } });
    const inner = merge(src, has, hasRows, ctx);
    if (inner === null) return null;
    if (has.length === ns.length) { out.push(inner); continue; }
    // only some copies have it: a branch on a flag in their data
    ctx.branches++;
    const f = field(ctx, `show${p + 1}`);
    rows.forEach((r) => { ctx.values[r]![f] = hasRows.includes(r); });
    out.push(`<dc-if test="${ctx.as}.${f}">${inner}</dc-if>`);
  }
  out.push(text(u.keys.length));
  return `${open}${out.join("")}${close}`;
}

/** Turn the run of copies around element `tid` into data + one repeated template. */
export type Made = { html: string; tid: number; key: string; index: number; count: number; fields: number; branches: number };
export function makeRepeat(src: string, tid: number): Made | { error: string } {
  const els = parse(src), el = els[tid];
  if (!el) return { error: "stale" };
  for (let x = el.parent; x; x = x.parent) if (x.tag === "dc-for") return { error: "in_repeat" };
  const run = runOf(src, els, el);
  if (run.length < 2) return { error: "no_twins" };
  const { el: dataEl, data } = dataOf(src, els);
  let key = "items", n = 1;
  while (key in data) key = `items${++n}`;
  const ctx: Ctx = { fields: new Map(), values: run.map(() => ({})), as: "it", branches: 0 };
  const tpl = merge(src, run.map((r) => nodeOf(src, r)), run.map((_, i) => i), ctx);
  if (tpl === null) return { error: "unmergeable" };
  const next = { ...data, [key]: ctx.values };
  const json = JSON.stringify(next, null, 2).replace(/</g, "\\u003c");
  const block = `<dc-for each="${key}" as="it">${tpl}</dc-for>`;
  // the data goes into the file's block, or a new one right before the repeat; splice the later range first
  const a = run[0]!.start, b = run[run.length - 1]!.end;
  // a new data block goes first in the body (or the file): never between the copies' siblings, where it would
  // shift ":nth-child" and "+" selectors
  const body = els.find((e) => e.tag === "body"), at = body ? body.openEnd : 0;
  const edits: Array<[number, number, string]> = [[a, b, block]];
  if (dataEl) edits.push([dataEl.openEnd, dataEl.closeStart, `\n${json}\n`]);
  else edits.push([at, at, `<script type="application/json" data-dc-data>\n${json}\n</script>\n`]);
  let html = src;
  for (const [x, y, t] of edits.sort((p, q) => q[0] - p[0])) html = html.slice(0, x) + t + html.slice(y);
  const after = parse(html), loop = after.find((e) => e.tag === "dc-for" && attr(html, e, "each") === key)!;
  return { html, tid: loop.children[0]!.tid, key, index: run.indexOf(el), count: run.length, fields: [...ctx.fields.values()].reduce((a, b) => a + b, 0), branches: ctx.branches };
}

/** Every run of hand-written copies in a file that makes a clean repeat: three or more alike, or two alike cards
 *  (an element with parts); at most 40 data fields and 6 branches each — copies that differ more stay as they are. */
export function repeatAll(src: string): { html: string; made: Array<{ key: string; count: number; tag: string }> } {
  const made: Array<{ key: string; count: number; tag: string }> = [];
  let html = hoistData(src), from = 0;
  for (let guard = 0; guard < 40; guard++) {
    const els = parse(html);
    let done = false;
    for (const el of els) {
      if (el.tid < from || ["html", "head", "body", "script", "style", "dc-for", "dc-if", "dc-import"].includes(el.tag)) continue;
      let inside = false;
      for (let x = el.parent; x; x = x.parent) if (x.tag === "dc-for" || x.tag === "head") inside = true;
      if (inside) continue;
      const run = runOf(html, els, el);
      if (run[0] !== el || run.length < 2 || (run.length < 3 && el.children.length < 2)) continue;
      const r = makeRepeat(html, el.tid);
      if ("error" in r || r.fields > 40 || r.branches > 6 || r.fields === 0) continue;
      html = r.html; made.push({ key: r.key, count: r.count, tag: el.tag }); from = r.tid; done = true;
      break;
    }
    if (!done) break;
  }
  return { html, made };
}

/** The data block first in the body (or the file), where it shifts no sibling selector of the design. */
export function hoistData(src: string): string {
  const els = parse(src), { el } = dataOf(src, els);
  if (!el) return src;
  const body = els.find((e) => e.tag === "body"), at = body ? body.openEnd : 0;
  if ((body ? el.parent === body : !el.parent) && !src.slice(at, el.start).trim()) return src;
  const block = src.slice(el.start, el.end);
  const without = src.slice(0, el.start) + src.slice(el.end);
  return without.slice(0, at) + block + "\n" + without.slice(at);
}
