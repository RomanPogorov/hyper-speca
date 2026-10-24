import { placeNew, sheetsOf } from "../../web/design/model.ts";
import { agentOf, loadBoard, save } from "../../web/design/tools.ts";

type Op =
  | { op: "move"; file: string; x: number; y: number }
  | { op: "rename"; file: string; title: string }
  | { op: "remove"; file: string }
  | { op: "resize"; file: string; w: number; h: number }
  | { op: "note"; id: string; kind: "title" | "sticky"; text: string; x: number; y: number; w?: number }
  | { op: "removeNote"; id: string }
  | { op: "toSheet"; file: string; sheet: string }
  | { op: "resolveComment"; id: string | number; reply?: string }
  | { op: "replyComment"; id: string | number; text: string };

/**
 * Changes the layout of a design canvas and answers its comments.
 *
 * Ops: move, resize, rename or remove artboards; toSheet moves one to another page of the canvas (by the page's
 * title; made if missing); note adds or moves a row title or a sticky, removeNote drops it; replyComment and
 * resolveComment answer and close the person's comments (ids from speca.designRead). Boards in a row sit 80px
 * apart, rows 120px apart; a row title sits 300px above its row with w = the row width.
 * @param opts.tabId The design canvas tab id.
 * @param opts.ops The changes, in order (1–60): `{ op: "move", file, x, y }`, `{ op: "resize", file, w, h }`, `{ op: "rename", file, title }`, `{ op: "remove", file }`, `{ op: "note", id, kind: "title"|"sticky", text, x, y, w? }`, `{ op: "removeNote", id }`, `{ op: "toSheet", file, sheet }`, `{ op: "replyComment", id, text }`, `{ op: "resolveComment", id, reply? }`.
 */
export default async function (ctx: Context, session: Session | null, opts: {
  /** The design canvas tab id. */
  tabId: number;
  /** The changes, in order (1–60). */
  ops: Op[];
}): Promise<string> {
  if (!Array.isArray(opts.ops) || !opts.ops.length || opts.ops.length > 60) throw new Error("speca.designLayout: ops — 1 to 60 changes");
  const b = await loadBoard(ctx, opts.tabId, await agentOf(ctx, session));
  const s = b.design;
  s.notes ??= {};
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  for (const o of opts.ops) {
    if ("file" in o && !s.boards[o.file]) throw new Error(`No artboard ${o.file}. Nothing was changed.`);
    if (o.op === "move") { if (!num(o.x) || !num(o.y)) throw new Error("move: x and y"); Object.assign(s.boards[o.file]!, { x: o.x, y: o.y }); }
    else if (o.op === "resize") { if (!(o.w >= 80 && o.h >= 80 && o.w <= 4000 && o.h <= 20000)) throw new Error("resize: w 80–4000, h 80–20000"); Object.assign(s.boards[o.file]!, { w: Math.round(o.w), h: Math.round(o.h) }); }
    else if (o.op === "rename") { if (!String(o.title ?? "").trim()) throw new Error("rename: title"); s.boards[o.file]!.title = o.title.trim().slice(0, 120); }
    else if (o.op === "remove") { delete s.boards[o.file]; delete s.files[o.file]; s.order = s.order.filter((f) => f !== o.file); }
    else if (o.op === "note") {
      if (!String(o.id ?? "").trim() || String(o.id).length > 40 || (o.kind !== "title" && o.kind !== "sticky") || !num(o.x) || !num(o.y)) throw new Error("note: { id, kind: title|sticky, text, x, y, w? }");
      s.notes[o.id] = { kind: o.kind, text: String(o.text ?? "").slice(0, 2000), x: o.x, y: o.y, ...(o.w ? { w: o.w } : {}) };
    }
    else if (o.op === "removeNote") delete s.notes[o.id];
    else if (o.op === "toSheet") {
      const want = String(o.sheet ?? "").trim().slice(0, 80);
      if (!want) throw new Error("toSheet: sheet");
      let list = sheetsOf(s), hit = list.find((p) => p.title.toLowerCase() === want.toLowerCase() || p.id === want);
      if (!hit) { s.sheets = list.map((p) => (p.title ? p : { ...p, title: "Страница 1" })); hit = { id: `p${Date.now().toString(36)}${s.sheets.length}`, title: want }; s.sheets.push(hit); list = s.sheets; }
      const bd = s.boards[o.file]!;
      Object.assign(bd, placeNew(s, bd.w, bd.h, hit.id));
      if (hit.id === list[0]!.id) delete bd.sheet; else bd.sheet = hit.id;
    }
    else if (o.op !== "resolveComment" && o.op !== "replyComment") throw new Error(`Unknown op ${(o as any).op}. Nothing was changed.`);
  }
  // comments live in the canvas's own store: answered and closed there (they are not edits of the design)
  const open = new Set(((await ctx.fns.canvas.comments({ itemId: b.id, all: true }).catch(() => [])) as any[]).map((c) => String(c.id)));
  for (const o of opts.ops) if ((o.op === "resolveComment" || o.op === "replyComment") && !open.has(String(o.id))) throw new Error(`No comment ${o.id} on this canvas.`);
  const edits = opts.ops.filter((o) => o.op !== "resolveComment" && o.op !== "replyComment").length;
  if (edits) await save(ctx, b, s, `layout: ${edits} change(s)`);
  for (const o of opts.ops) {
    if (o.op === "replyComment") await ctx.fns.canvas.addComment({ itemId: b.id, parentId: Number(o.id), text: String(o.text), author: "agent" });
    if (o.op === "resolveComment") await ctx.fns.canvas.resolveComment({ id: Number(o.id), ...(o.reply ? { reply: o.reply } : {}) });
  }
  return `Applied ${opts.ops.length} change(s).`;
}
