import { FILE, outline, sheetOf, sheetsOf } from "../../web/design/model.ts";
import { agentOf, loadBoard } from "../../web/design/tools.ts";

/**
 * Reads a design canvas: the index, or one artboard with an outline of its elements.
 *
 * Without `file` — the artboards with titles, sizes and positions, pages, row titles and stickies, and the open
 * comments with the element each is pinned to. With `file` — that artboard's HTML and an outline of its elements
 * with tids, to resolve an address like "Main.html#12:0/1/3" (tid 12) the person points at.
 * @param opts.tabId The design canvas tab id.
 * @param opts.file One artboard to read. @default the index
 */
export default async function (ctx: Context, session: Session | null, opts: {
  /** The design canvas tab id. */
  tabId: number;
  /** One artboard to read. @default the index */
  file?: string;
}): Promise<string> {
  const b = await loadBoard(ctx, opts.tabId, await agentOf(ctx, session));
  const s = b.design;
  if (!opts.file) {
    const notes = Object.entries(s.notes ?? {}).map(([id, n]) => `- note ${id} (${n.kind}) "${n.text.slice(0, 60)}" at ${n.x},${n.y}`);
    // the comments: the canvas's own store (target.file / tid is the artboard address)
    const list = (await ctx.fns.canvas.comments({ itemId: b.id }).catch(() => [])) as any[];
    const comments = list.map((c) => {
      const t = c.target ?? {}, at = t.file ? `${t.file}${t.tid != null && t.tid >= 0 ? `#${t.tid}` : ""}` : t.path ?? "";
      return `- comment ${c.id} on [${c.quote ?? ""}](${at}) by ${c.author === "agent" ? "you" : "the person"}: "${String(c.text).slice(0, 400)}"${(c.replies ?? []).map((r: any) => `\n    ↳ ${r.author === "agent" ? "you" : "the person"}: "${String(r.text).slice(0, 200)}"`).join("")}`;
    });
    const pages = sheetsOf(s), many = pages.length > 1, pageOf = (x: { sheet?: string }) => pages.find((p) => p.id === sheetOf(s, x))!;
    return `Design canvas "${s.title ?? ""}" (tab ${b.id})${many ? `\nPages: ${pages.map((p) => `"${p.title}"`).join(", ")}` : ""}\nArtboards:\n${s.order.filter((f) => s.boards[f]).map((f) => { const x = s.boards[f]!; return `- ${f} · "${x.title}" · ${x.w}×${x.h}${x.page ? " page" : ""} at ${x.x},${x.y}${many ? ` · on page "${pageOf(x).title}"` : ""}${x.pending ? " · waiting to be drawn (speca.designWrite)" : ""}`; }).join("\n")}${notes.length ? `\nNotes:\n${notes.join("\n")}` : ""}${comments.length ? `\nOpen comments:\n${comments.join("\n")}` : ""}`;
  }
  if (!FILE.test(opts.file)) throw new Error(`speca.designRead: bad file name ${opts.file}`);
  const html = s.files[opts.file];
  if (html === undefined) throw new Error(s.boards[opts.file]?.pending ? `${opts.file} is planned but not drawn yet: draw it with speca.designWrite.` : `No artboard ${opts.file}.`);
  return `${opts.file} — "${s.boards[opts.file]?.title}"\n\nOutline (#tid tag "text"):\n${await outline(html)}\n\nHTML:\n${html.slice(0, 60_000)}`;
}
