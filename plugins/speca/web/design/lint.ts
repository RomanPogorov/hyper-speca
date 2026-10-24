// What the agent hears after drawing an artboard: things of one kind that will not be edited as one. Elements are
// alike (selected together, restyled together) when tag, class and style match; a run of three or more siblings of
// one tag and class whose styles differ only a little is most likely meant to be alike — say which and how.
import { parse, attr, parseStyle, type El } from "./dom.ts";
import { canon } from "./repeat.ts";

export function alikeNotes(file: string, src: string): string[] {
  const els = parse(src), notes: string[] = [];
  const groups = new Map<string, typeof els>();
  for (const e of els) {
    if (!e.parent || ["script", "style", "br", "svg", "path", "dc-for", "dc-if"].includes(e.tag)) continue;
    let inRepeat = false;
    for (let x: El | null = e.parent; x; x = x.parent) if (x.tag === "dc-for") inRepeat = true;
    if (inRepeat) continue;
    const k = `${e.parent.tid}|${e.tag}|${(attr(src, e, "class") ?? "").trim()}`;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  for (const list of groups.values()) {
    if (list.length < 3) continue;
    const styles = list.map((e) => canon(attr(src, e, "style")));
    const kinds = new Set(styles);
    if (kinds.size < 2 || kinds.size > Math.ceil(list.length / 2)) continue;
    // what differs between them: the declarations not shared by all
    const decls = list.map((e) => new Map(parseStyle(attr(src, e, "style") ?? "")));
    const props = new Set(decls.flatMap((d) => [...d.keys()]));
    const diff = [...props].filter((p) => decls.some((d) => d.get(p) !== decls[0]!.get(p)));
    if (diff.length > 2) continue;   // different things, not one kind written unevenly
    const e0 = list[0]!;
    notes.push(`${list.length} <${e0.tag}${attr(src, e0, "class") ? ` class="${attr(src, e0, "class")}"` : ""}> side by side (from #${e0.tid}) differ in ${diff.slice(0, 4).join(", ") || "style"} — if they are one kind, write the same style on each (or a <dc-for> over data), so the person selects and restyles them together`);
    if (notes.length >= 4) break;
  }
  return notes.map((n) => `${file}: ${n}`);
}
export const alikeNote = (notes: string[]) => (notes.length ? `\nNote (alike elements):\n- ${notes.join("\n- ")}` : "");
