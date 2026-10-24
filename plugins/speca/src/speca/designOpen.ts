import { FILE, layoutRows, type DesignState } from "../../web/design/model.ts";
import { alikeNotes, alikeNote } from "../../web/design/lint.ts";

/**
 * Opens a design canvas with the plan: every screen and state as an artboard (file, title, size), in rows by flow.
 *
 * One row per flow or screen family, the row's title above it; boards 80px apart, rows 120px apart — computed here.
 * Leave out `html`: the canvas opens at once with each artboard waiting, and the person watches them appear as you
 * draw them one by one with speca.designWrite, in the plan's order. Put html here only for one or two small boards.
 * Read speca.designGuide() before the first artboard. Returns the tab id and the files still to draw.
 * @param opts.title The canvas title.
 * @param opts.rows Rows of artboards: `{ title?, boards: [{ file: "01-welcome.html", title: "01 Welcome", w: 390, h: 844, page?, html? }] }`.
 * @param opts.agentId Agent whose canvas to use. @default the current agent
 */
export default async function (ctx: Context, _session: Session | null, opts: {
  /** The canvas title. */
  title: string;
  /** Rows of artboards, each `{ title?, boards: [{ file, title, w, h, page?, html? }] }` (1–12 rows, 1–24 boards each). */
  rows: Array<{ title?: string; boards: Array<{ file: string; title: string; w: number; h: number; page?: boolean; html?: string }> }>;
  /** Agent whose canvas to use. @default the current agent */
  agentId?: string;
}): Promise<{ tabId: number; waiting: string[]; text: string }> {
  const title = String(opts.title ?? "").trim();
  if (!title || title.length > 200) throw new Error("speca.designOpen: title is required (up to 200 characters)");
  if (!Array.isArray(opts.rows) || !opts.rows.length || opts.rows.length > 12) throw new Error("speca.designOpen: rows — 1 to 12 rows");
  const files: Record<string, string> = {}, seen = new Set<string>(), waiting: string[] = [];
  for (const r of opts.rows) {
    if (!Array.isArray(r.boards) || !r.boards.length || r.boards.length > 24) throw new Error("speca.designOpen: each row has 1 to 24 boards");
    for (const b of r.boards) {
      if (!FILE.test(String(b.file))) throw new Error(`speca.designOpen: bad file name ${b.file} (like 01-welcome.html)`);
      if (!String(b.title ?? "").trim()) throw new Error(`speca.designOpen: ${b.file} needs a title`);
      if (!(b.w >= 80 && b.w <= 4000 && b.h >= 80 && b.h <= 20000)) throw new Error(`speca.designOpen: ${b.file} — w 80–4000, h 80–20000`);
      if (seen.has(b.file)) throw new Error(`speca.designOpen: duplicate file name ${b.file}`);
      seen.add(b.file);
      if (b.html) files[b.file] = b.html; else waiting.push(b.file);
    }
  }
  const state: DesignState = { title, ...layoutRows(opts.rows.map((r) => ({ title: r.title, boards: r.boards.map((b) => ({ file: b.file, title: String(b.title).slice(0, 120), w: Math.round(b.w), h: Math.round(b.h), page: b.page })) }))), files };
  // planned, not drawn: the canvas shows these frames waiting until speca.designWrite fills them
  for (const f of waiting) state.boards[f]!.pending = true;
  const tab = await ctx.fns.canvas.show({ kind: "speca.design", args: state, title, ...(opts.agentId ? { agentId: opts.agentId } : {}) });
  const text = `Opened design canvas ${tab.id} with ${seen.size} artboard(s)${waiting.length ? `; waiting to be drawn, in this order: ${waiting.join(", ")} — draw each with speca.designWrite (one call per artboard)` : ""}.${alikeNote(Object.entries(files).flatMap(([f, h]) => alikeNotes(f, h)))}`;
  return { tabId: tab.id, waiting, text };
}
