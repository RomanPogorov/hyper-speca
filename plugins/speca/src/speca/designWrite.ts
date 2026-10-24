import { FILE, placeNew, sheetsOf } from "../../web/design/model.ts";
import { alikeNotes, alikeNote } from "../../web/design/lint.ts";
import { agentOf, focus, loadBoard, save } from "../../web/design/tools.ts";

/**
 * Adds an artboard to a design canvas, or replaces one artboard's whole file (draws a planned one).
 *
 * New boards go to the right of the last row (of their page) unless x/y are given. `sheet` is the page of the canvas
 * to put a new board on, by its title (made if missing) — for separate sets like flows or variants. For small
 * changes use speca.designEdit instead. Every call is one undo step and brings the board into view.
 * @param opts.tabId The design canvas tab id.
 * @param opts.file Artboard file name, like `01-welcome.html`.
 * @param opts.html The artboard's markup (one root element; inline styles).
 * @param opts.title Board title. @default the planned one or the file name
 * @param opts.w Width in px. @default the planned one or 390
 * @param opts.h Height in px. @default the planned one or 844
 * @param opts.page A fluid page root (max-width container) rather than a fixed screen.
 * @param opts.sheet The page of the canvas, by its title (made if missing).
 * @param opts.x Position on the canvas. @default next to the last row
 * @param opts.y Position on the canvas. @default next to the last row
 */
export default async function (ctx: Context, session: Session | null, opts: {
  /** The design canvas tab id. */
  tabId: number;
  /** Artboard file name, like `01-welcome.html`. */
  file: string;
  /** The artboard's markup (one root element; inline styles). */
  html: string;
  /** Board title. @default the planned one or the file name */
  title?: string;
  /** Width in px. @default the planned one or 390 */
  w?: number;
  /** Height in px. @default the planned one or 844 */
  h?: number;
  /** A fluid page root (max-width container) rather than a fixed screen. */
  page?: boolean;
  /** The page of the canvas, by its title (made if missing). */
  sheet?: string;
  /** Position on the canvas. @default next to the last row */
  x?: number;
  /** Position on the canvas. @default next to the last row */
  y?: number;
}): Promise<{ text: string; waiting: string[] }> {
  if (!FILE.test(String(opts.file))) throw new Error(`speca.designWrite: bad file name ${opts.file} (like 01-welcome.html)`);
  if (typeof opts.html !== "string" || !opts.html.trim() || opts.html.length > 400_000) throw new Error("speca.designWrite: html is required (up to 400000 characters)");
  const b = await loadBoard(ctx, opts.tabId, await agentOf(ctx, session));
  const s = b.design;
  const prev = s.boards[opts.file];
  const w = Math.round(opts.w ?? prev?.w ?? 390), h = Math.round(opts.h ?? prev?.h ?? 844);
  if (!(w >= 80 && w <= 4000 && h >= 80 && h <= 20000)) throw new Error("speca.designWrite: w 80–4000, h 80–20000");
  // the page it goes on: named by its title, made if missing (the first page gets a name then too)
  let sheet = prev?.sheet;
  if (opts.sheet?.trim() && !prev) {
    const want = opts.sheet.trim().slice(0, 80);
    const list = sheetsOf(s), hit = list.find((p) => p.title.toLowerCase() === want.toLowerCase() || p.id === want);
    if (hit) sheet = hit.id;
    else { s.sheets = list.map((p) => (p.title ? p : { ...p, title: "Страница 1" })); sheet = `p${Date.now().toString(36)}`; s.sheets.push({ id: sheet, title: want }); }
    if (sheet === sheetsOf(s)[0]!.id) sheet = undefined;
  }
  const pos = prev ? { x: opts.x ?? prev.x, y: opts.y ?? prev.y } : opts.x !== undefined && opts.y !== undefined ? { x: opts.x, y: opts.y } : placeNew(s, w, h, sheet ?? sheetsOf(s)[0]!.id);
  // a planned artboard drawn now stops waiting (the new entry has no `pending`)
  s.boards[opts.file] = { ...pos, w, h, title: (opts.title ?? prev?.title ?? opts.file.replace(/\.html$/, "")).slice(0, 120), ...(opts.page ?? prev?.page ? { page: true } : {}), ...(sheet ? { sheet } : {}) };
  if (!s.order.includes(opts.file)) s.order.push(opts.file);
  s.files[opts.file] = opts.html;
  await save(ctx, b, s, `${prev && !prev.pending ? "redrew" : "drew"} ${s.boards[opts.file]!.title}`);
  // the person follows the work: a board drawn now comes into view, on its page
  if (!prev || prev.pending) await focus(ctx, b, opts.file);
  const left = s.order.filter((f) => s.boards[f]?.pending);
  return { text: `${prev?.pending ? "Drew" : prev ? "Replaced" : "Added"} ${opts.file} (${w}×${h}).${left.length ? ` Still waiting, in order: ${left.join(", ")}.` : ""}${alikeNote(alikeNotes(opts.file, opts.html))}`, waiting: left };
}
