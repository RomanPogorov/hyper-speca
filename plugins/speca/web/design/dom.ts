// The artboard source as a tree of elements with their offsets in the text, numbered in preorder exactly as the frame
// numbers them (HTMLRewriter on "*", data-tid). Every edit made from the canvas is a splice of the source: the file
// stays the agent's file — no reformatting, no serializer, nothing it did not ask for.

export type El = { tid: number; tag: string; start: number; openEnd: number; closeStart: number; end: number; parent: El | null; children: El[] };

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const RAW = new Set(["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "plaintext"]);
// a start tag of the key closes an open element of these tags (the common implied ends)
const CLOSES: Record<string, string[]> = { li: ["li"], dt: ["dt", "dd"], dd: ["dt", "dd"], tr: ["tr", "td", "th"], td: ["td", "th"], th: ["td", "th"], option: ["option"] };

export function parse(src: string): El[] {
  const all: El[] = [];
  const stack: El[] = [];
  const close = (el: El, at: number, end: number) => { el.closeStart = at; el.end = end; };
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt < 0) break;
    if (src.startsWith("<!--", lt)) { const e = src.indexOf("-->", lt + 4); i = e < 0 ? src.length : e + 3; continue; }
    if (src[lt + 1] === "!" || src[lt + 1] === "?") { const e = src.indexOf(">", lt); i = e < 0 ? src.length : e + 1; continue; }
    if (src[lt + 1] === "/") {
      const m = /^<\/([a-zA-Z][^\s/>]*)[^>]*>/.exec(src.slice(lt, lt + 200));
      if (!m) { i = lt + 1; continue; }
      const tag = m[1]!.toLowerCase(), end = lt + m[0].length;
      const at = stack.map((e) => e.tag).lastIndexOf(tag);
      if (at >= 0) { while (stack.length > at + 1) close(stack.pop()!, lt, lt); close(stack.pop()!, lt, end); }
      i = end; continue;
    }
    if (!/[a-zA-Z]/.test(src[lt + 1] ?? "")) { i = lt + 1; continue; }
    const openEnd = tagEnd(src, lt);
    const tag = /^<([^\s/>]+)/.exec(src.slice(lt, lt + 100))![1]!.toLowerCase();
    const closes = CLOSES[tag];
    if (closes && stack.length && closes.includes(stack[stack.length - 1]!.tag)) { const top = stack.pop()!; close(top, lt, lt); }
    const parent = stack[stack.length - 1] ?? null;
    const el: El = { tid: all.length, tag, start: lt, openEnd, closeStart: openEnd, end: openEnd, parent, children: [] };
    all.push(el); parent?.children.push(el);
    i = openEnd;
    if (VOID.has(tag) || src[openEnd - 2] === "/") continue;
    if (RAW.has(tag)) {
      const re = new RegExp(`</${tag}\\s*>`, "ig"); re.lastIndex = openEnd;
      const m = re.exec(src);
      close(el, m ? m.index : src.length, m ? m.index + m[0].length : src.length);
      i = el.end; continue;
    }
    stack.push(el);
  }
  while (stack.length) close(stack.pop()!, src.length, src.length);
  return all;
}

/** The index after the `>` of the tag that starts at `lt`, honouring quoted attribute values. */
function tagEnd(src: string, lt: number): number {
  let q = "";
  for (let j = lt + 1; j < src.length; j++) {
    const c = src[j]!;
    if (q) { if (c === q) q = ""; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === ">") return j + 1;
  }
  return src.length;
}

// ── inline style: an ordered list of declarations, so untouched ones keep their place and spelling ──
export function parseStyle(s: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let buf = "", depth = 0, q = "";
  const flush = () => { const k = buf.indexOf(":"); if (k > 0) { const p = buf.slice(0, k).trim().toLowerCase(), v = buf.slice(k + 1).trim(); if (p && v) out.push([p, v]); } buf = ""; };
  for (const c of s) {
    if (q) { buf += c; if (c === q) q = ""; continue; }
    if (c === '"' || c === "'") q = c;
    if (c === "(") depth++;
    if (c === ")") depth = Math.max(0, depth - 1);
    if (c === ";" && !depth) { flush(); continue; }
    buf += c;
  }
  flush();
  return out;
}

const attrRe = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** The value of an attribute of the element's start tag (entities left as they are), or null. */
export function attr(src: string, el: El, name: string): string | null {
  const open = src.slice(el.start, el.openEnd);
  attrRe.lastIndex = 1 + el.tag.length + 1;
  for (let m; (m = attrRe.exec(open)); ) if (m[1]!.toLowerCase() === name) return m[2] ?? m[3] ?? m[4] ?? "";
  return null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** The start tag with its style changed: set props get their value (in place, or appended), null removes them. */
function restyle(src: string, el: El, changes: Record<string, string | null>): string {
  const open = src.slice(el.start, el.openEnd);
  const decl = parseStyle(unesc(attr(src, el, "style") ?? ""));
  for (const [p, v] of Object.entries(changes)) {
    const k = p.toLowerCase(), at = decl.findIndex(([q]) => q === k);
    if (v === null || v === "") { if (at >= 0) decl.splice(at, 1); continue; }
    if (at >= 0) decl[at] = [k, v]; else decl.push([k, v]);
  }
  const value = decl.map(([p, v]) => `${p}: ${v}`).join("; ");
  const m = /\sstyle\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+)/i.exec(open);
  if (m) return value ? open.slice(0, m.index) + ` style="${esc(value)}"` + open.slice(m.index + m[0].length) : open.slice(0, m.index) + open.slice(m.index + m[0].length);
  if (!value) return open;
  const tail = open.endsWith("/>") ? 2 : 1;
  return `${open.slice(0, open.length - tail).replace(/\s+$/, "")} style="${esc(value)}"${open.slice(open.length - tail)}`;
}

export type Op =
  | { op: "style"; tid: number; changes: Record<string, string | null> }
  | { op: "text"; tid: number; text: string; template?: boolean; html?: string }
  | { op: "unwrap"; tid: number }
  | { op: "zorder"; tid: number; dir: "front" | "back" }
  | { op: "delete"; tid: number }
  | { op: "duplicate"; tid: number }
  | { op: "move"; tid: number; dir: "up" | "down" }
  | { op: "wrap"; tid: number; layout: "stack" | "row" | "grid" }
  | { op: "reorder"; tid: number; to: number }
  | { op: "attr"; tid: number; name: string; value: string | null };

export type Done = { html: string; select?: number; note: string };

/** The inline markup a person may give a text in place (bold, italic, underline…): only these tags, no attributes
 *  but a link's safe href; anything else keeps its text and loses its tag. */
const INLINE = new Set(["b", "strong", "i", "em", "u", "s", "br", "a", "code", "mark", "sub", "sup", "small", "span"]);
export function inlineHtml(raw: string): string {
  let out = "";
  const open: string[] = [];
  for (const m of raw.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|([^<]+)|</g)) {
    if (m[4] !== undefined) { out += m[4].replace(/&(?!(amp|lt|gt|quot|nbsp|#\d+|#x[0-9a-f]+);)/gi, "&amp;").replace(/>/g, "&gt;"); continue; }
    if (m[0] === "<") { out += "&lt;"; continue; }
    const tag = m[2]!.toLowerCase(), closing = m[1] === "/";
    if (!INLINE.has(tag)) continue;
    if (tag === "br") { if (!closing) out += "<br>"; continue; }
    if (closing) { const i = open.lastIndexOf(tag); if (i >= 0) while (open.length > i) out += `</${open.pop()}>`; continue; }
    const href = tag === "a" ? /\bhref\s*=\s*"([^"]*)"/i.exec(m[3] ?? "")?.[1] : undefined;
    out += `<${tag}${href && /^(https?:|mailto:|#|\/)/i.test(unesc(href)) ? ` href="${esc(unesc(href))}"` : ""}>`;
    open.push(tag);
  }
  while (open.length) out += `</${open.pop()}>`;
  return out;
}

/** Apply one edit by tid. Returns the new source and what to select after it, or a reason it cannot be done. */
export function apply(src: string, o: Op): Done | { error: string } {
  const els = parse(src);
  const el = els[o.tid];
  if (!el) return { error: "stale" };
  const body = els.find((e) => e.tag === "body");
  const inBody = !!body && el.start > body.start && el.end <= body.closeStart || !body && !["html", "head"].includes(el.tag);
  if (o.op !== "style" && o.op !== "text" && !inBody) return { error: "outside" };
  const outer = src.slice(el.start, el.end);
  const sibs = el.parent ? el.parent.children : els.filter((e) => !e.parent);
  switch (o.op) {
    case "style":
      return { html: src.slice(0, el.start) + restyle(src, el, o.changes) + src.slice(el.openEnd), note: `style of #${o.tid} (${Object.keys(o.changes).join(", ")})` };
    case "text": {
      // a text with holes is a template: only an edit made on the template (showing the holes) may replace it
      if (src.slice(el.openEnd, el.closeStart).includes("{{") && !o.template) return { error: "bound" };
      if (el.children.some((c) => !["b", "strong", "i", "em", "u", "s", "small", "br", "span", "a", "code", "mark", "sub", "sup"].includes(c.tag))) return { error: "children" };
      // with its inline markup (bold, italic… made in place), else plain text
      const text = o.html !== undefined && !o.template ? inlineHtml(o.html) : o.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
      return { html: src.slice(0, el.openEnd) + text + src.slice(el.closeStart), note: `text of #${o.tid}` };
    }
    case "delete":
      return { html: src.slice(0, el.start) + src.slice(el.end), note: `removed #${o.tid} ${el.tag}` };
    case "duplicate": {
      const gap = /\s*$/.exec(src.slice(0, el.start))![0].replace(/^[^\n]*\n/, "\n") || "";
      const size = countIn(el);
      return { html: src.slice(0, el.end) + (gap.includes("\n") ? gap : "") + outer + src.slice(el.end), select: o.tid + size, note: `duplicated #${o.tid} ${el.tag}` };
    }
    case "move": {
      const at = sibs.indexOf(el), other = sibs[o.dir === "up" ? at - 1 : at + 1];
      if (!other) return { error: "edge" };
      const [a, b] = o.dir === "up" ? [other, el] : [el, other];
      const html = src.slice(0, a.start) + src.slice(b.start, b.end) + src.slice(a.end, b.start) + src.slice(a.start, a.end) + src.slice(b.end);
      return { html, select: o.dir === "up" ? other.tid : o.tid + countIn(other), note: `moved #${o.tid} ${el.tag} ${o.dir}` };
    }
    case "reorder": {
      // take the element out and put it before the sibling now at `to` (the end when there is none)
      const rest = sibs.filter((x) => x !== el), to = Math.max(0, Math.min(o.to, rest.length));
      if (to === sibs.indexOf(el)) return { error: "edge" };
      const cut = src.slice(0, el.start) + src.slice(el.end), shift = (n: number) => (n >= el.end ? n - (el.end - el.start) : n);
      const at = to < rest.length ? shift(rest[to]!.start) : shift(rest[rest.length - 1]!.end);
      const html = cut.slice(0, at) + outer + cut.slice(at);
      const p = el.parent ? parse(html)[el.parent.tid] : null;
      return { html, select: p ? p.children[to]?.tid : undefined, note: `moved #${o.tid} ${el.tag} to place ${to + 1}` };
    }
    case "attr": {
      const open = src.slice(el.start, el.openEnd), name = o.name.toLowerCase();
      const re = new RegExp(`\\s${name.replace(/[-]/g, "\\-")}(?:\\s*=\\s*("[^"]*"|'[^']*'|[^\\s"'=<>\`]+))?(?=[\\s/>])`, "i");
      const m = re.exec(open);
      let next = m ? open.slice(0, m.index) + open.slice(m.index + m[0].length) : open;
      if (o.value !== null) { const tail = next.endsWith("/>") ? 2 : 1; next = `${next.slice(0, next.length - tail).replace(/\s+$/, "")} ${name}="${esc(o.value)}"${next.slice(next.length - tail)}`; }
      return { html: src.slice(0, el.start) + next + src.slice(el.openEnd), note: `${name} of #${o.tid}` };
    }
    case "unwrap": {
      // a group undone: its children take its place (not a repeat, a branch or a component)
      if (!el.children.length || el.tag.startsWith("dc-")) return { error: "edge" };
      return { html: src.slice(0, el.start) + src.slice(el.openEnd, el.closeStart).replace(/^\s*\n|\n\s*$/g, "") + src.slice(el.end), select: o.tid, note: `ungrouped #${o.tid} ${el.tag}` };
    }
    case "zorder": {
      // in front of / behind its siblings: z-index past theirs (positioned, so z-index applies)
      const zOf = (e: El) => Number(/(?:^|;)\s*z-index\s*:\s*(-?\d+)/i.exec(unesc(attr(src, e, "style") ?? ""))?.[1] ?? 0);
      const others = sibs.filter((x) => x !== el).map(zOf);
      const z = o.dir === "front" ? Math.max(0, ...others) + 1 : Math.min(0, ...others) - 1;
      const own = unesc(attr(src, el, "style") ?? "");
      return { html: src.slice(0, el.start) + restyle(src, el, { "z-index": String(z), ...(/(?:^|;)\s*position\s*:/i.test(own) ? {} : { position: "relative" }) }) + src.slice(el.openEnd), select: o.tid, note: `#${o.tid} ${el.tag} to the ${o.dir}` };
    }
    case "wrap": {
      const style = o.layout === "grid" ? "display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px" : `display: flex; flex-direction: ${o.layout === "row" ? "row" : "column"}; gap: 12px`;
      return { html: `${src.slice(0, el.start)}<div style="${style}">${outer}</div>${src.slice(el.end)}`, select: o.tid, note: `wrapped #${o.tid} ${el.tag} in a ${o.layout}` };
    }
  }
}

/** Several siblings put into one group (a column), where the first of them was; the group is selected. */
export function group(src: string, tids: number[], layout: "stack" | "row" = "stack"): Done | { error: string } {
  const els = parse(src);
  const list = [...new Set(tids)].map((t) => els[t]).filter((e): e is El => !!e).sort((a, b) => a.start - b.start);
  if (list.length < 2) return { error: "edge" };
  if (list.some((e) => e.parent !== list[0]!.parent || e.tag.startsWith("dc-"))) return { error: "siblings" };
  const style = `display: flex; flex-direction: ${layout === "row" ? "row" : "column"}; gap: 12px`;
  const inner = list.map((e) => src.slice(e.start, e.end)).join("\n");
  let html = src;
  for (const e of [...list].reverse()) html = html.slice(0, e.start) + (e === list[0] ? `<div style="${style}">${inner}</div>` : "") + html.slice(e.end);
  return { html, select: list[0]!.tid, note: `grouped ${list.length} elements` };
}

/** The same edit on several elements of one file. They are applied from the last to the first (a moved element
 *  keeps the tids before it), moves up first-to-last; elements inside another target are dropped. The selection
 *  that follows is the first target's. */
export function applyMany(src: string, o: Op, tids: number[]): Done | { error: string } {
  const els = parse(src);
  const uniq = [...new Set(tids)].filter((t) => els[t]);
  if (!uniq.length) return { error: "stale" };
  const inside = (t: number) => uniq.some((u) => u !== t && els[u]!.start <= els[t]!.start && els[t]!.end <= els[u]!.end);
  // a style may go to an element and one inside it alike; structure on the outer one carries the inner
  const list = o.op === "style" ? uniq : uniq.filter((t) => !inside(t));
  if (o.op === "text") return apply(src, { ...o, tid: list[0]! });
  const primary = list[0]!;
  const order = [...list].sort((a, b) => (o.op === "move" && o.dir === "up" ? a - b : b - a));
  let html = src, select: number | undefined, notes: string[] = [], picked = false;
  for (const t of order) {
    const before = parse(html).length;
    const r = apply(html, { ...o, tid: t } as Op);
    if ("error" in r) { if (list.length === 1 || r.error === "stale") return r; continue; }
    const delta = parse(r.html).length - before;
    if (picked && select !== undefined && t < select) select += delta;
    if (t === primary) { select = r.select; picked = true; }
    html = r.html; notes.push(r.note);
  }
  if (html === src) return { error: "edge" };
  return { html, select, note: notes.length > 1 ? `${notes[0]} (+${notes.length - 1} more)` : notes[0] ?? "" };
}

/** How many elements the subtree holds (itself included) — the tid shift of whatever follows it. */
const countIn = (el: El): number => 1 + el.children.reduce((n, c) => n + countIn(c), 0);
