// What changed in an artboard between two versions, as a designer reads it: the texts that changed, the styles and
// classes, pictures replaced, elements added and removed. It reads the artboards as drawn (lib/template.ts render): texts
// that come from a template's data are compared as they show. Elements are matched by their own content (tag, own
// text, the attributes that show), in order; an unmatched pair of the same tag next to each other is one element changed.
import { parse, attr, parseStyle, type El } from "./dom.ts";

export type Change =
  | { kind: "text"; tag: string; before: string; after: string }
  | { kind: "style"; tag: string; props: Array<{ prop: string; before: string | null; after: string | null }> }
  | { kind: "class"; tag: string; before: string; after: string }
  | { kind: "image"; tag: string }
  | { kind: "link"; tag: string; before: string; after: string }
  | { kind: "css" }
  | { kind: "added" | "removed"; tag: string; text: string };


type Node = { tag: string; text: string; style: string; cls: string; src: string; href: string; key: string };
const SHOWN = ["style", "class", "src", "href", "alt", "placeholder", "value", "type"];
const NOT_SHOWN = new Set(["head", "meta", "link", "title", "script", "template", "dc-for", "dc-if"]);

/** The text an element holds itself (not its children's), its spaces collapsed. */
function ownText(src: string, el: El): string {
  if (el.tag === "style") return src.slice(el.openEnd, el.closeStart);
  let out = "", at = el.openEnd;
  for (const c of el.children) { out += src.slice(at, c.start); at = c.end; }
  out += src.slice(at, el.closeStart);
  return out.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}

function nodes(src: string): Node[] {
  return parse(src).filter((el) => !NOT_SHOWN.has(el.tag)).map((el) => {
    const a = (n: string) => (attr(src, el, n) ?? "").trim();
    const text = ownText(src, el);
    return { tag: el.tag, text, style: a("style"), cls: a("class"), src: a("src"), href: a("href"),
      key: [el.tag, text, ...SHOWN.map(a)].join("\u0001") };
  });
}

/** Indices of the longest common subsequence of two key lists (pairs [i, j]); a plain DP, bounded. */
function lcs(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length, m = b.length;
  if (n * m > 6_000_000) {
    // too big to align: the same position counts as the same element
    const out: Array<[number, number]> = [];
    for (let i = 0; i < Math.min(n, m); i++) if (a[i] === b[i]) out.push([i, i]);
    return out;
  }
  const dp = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i * (m + 1) + j] = a[i] === b[j] ? dp[(i + 1) * (m + 1) + j + 1]! + 1 : Math.max(dp[(i + 1) * (m + 1) + j]!, dp[i * (m + 1) + j + 1]!);
  const out: Array<[number, number]> = [];
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i] === b[j]) { out.push([i, j]); i++; j++; }
    else if (dp[(i + 1) * (m + 1) + j]! >= dp[i * (m + 1) + j + 1]!) i++;
    else j++;
  }
  return out;
}

const clip = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function diffBoard(before: string, after: string): Change[] {
  const A = nodes(before), B = nodes(after);
  const same = lcs(A.map((x) => x.key), B.map((x) => x.key));
  const changes: Change[] = [];
  // walk the gaps between matched elements: what is left on each side is removed / added — or, paired by tag, changed
  let pi = 0, pj = 0;
  for (const [mi, mj] of [...same, [A.length, B.length] as [number, number]]) {
    const gone = A.slice(pi, mi), came = B.slice(pj, mj);
    const used = new Set<number>();
    for (const x of gone) {
      const k = came.findIndex((y, i) => !used.has(i) && y.tag === x.tag);
      if (k < 0) {
        if (x.text || x.tag === "img" || x.tag === "button" || x.tag === "input") changes.push({ kind: "removed", tag: x.tag, text: clip(x.text) });
        continue;
      }
      used.add(k);
      const y = came[k]!;
      if (x.tag === "style") { changes.push({ kind: "css" }); continue; }
      if (x.text !== y.text) changes.push({ kind: "text", tag: x.tag, before: clip(x.text), after: clip(y.text) });
      if (x.style !== y.style) {
        const sa = new Map(parseStyle(x.style)), sb = new Map(parseStyle(y.style));
        const props = [...new Set([...sa.keys(), ...sb.keys()])].filter((p) => sa.get(p) !== sb.get(p)).map((p) => ({ prop: p, before: sa.get(p) ?? null, after: sb.get(p) ?? null }));
        if (props.length) changes.push({ kind: "style", tag: x.tag, props: props.slice(0, 6) });
      }
      if (x.cls !== y.cls) changes.push({ kind: "class", tag: x.tag, before: x.cls, after: y.cls });
      if (x.src !== y.src) changes.push({ kind: "image", tag: x.tag });
      if (x.href !== y.href) changes.push({ kind: "link", tag: x.tag, before: x.href, after: y.href });
    }
    came.forEach((y, i) => {
      if (used.has(i)) return;
      if (y.text || y.tag === "img" || y.tag === "button" || y.tag === "input") changes.push({ kind: "added", tag: y.tag, text: clip(y.text) });
    });
    pi = mi + 1; pj = mj + 1;
  }
  return changes;
}
