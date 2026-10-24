import { FILE } from "../../web/design/model.ts";
import { alikeNotes, alikeNote } from "../../web/design/lint.ts";
import { agentOf, focus, loadBoard, save } from "../../web/design/tools.ts";

/**
 * Changes part of one artboard by replacing exact snippets of its HTML, like editing code.
 *
 * Each edit has `old` (exact, unique unless `all`) and `new`. All edits apply together or none. The way to make
 * every change that is not a full redraw; one call is one undo step.
 * @param opts.tabId The design canvas tab id.
 * @param opts.file Artboard file name.
 * @param opts.edits Snippet replacements `[{ old, new, all? }]` (1–60).
 * @param opts.note What changed, in a few words. @default "<title>: N edit(s)"
 */
export default async function (ctx: Context, session: Session | null, opts: {
  /** The design canvas tab id. */
  tabId: number;
  /** Artboard file name. */
  file: string;
  /** Snippet replacements `[{ old, new, all? }]` (1–60). */
  edits: Array<{ old: string; new: string; all?: boolean }>;
  /** What changed, in a few words. @default "<title>: N edit(s)" */
  note?: string;
}): Promise<{ text: string }> {
  if (!FILE.test(String(opts.file))) throw new Error(`speca.designEdit: bad file name ${opts.file}`);
  if (!Array.isArray(opts.edits) || !opts.edits.length || opts.edits.length > 60) throw new Error("speca.designEdit: edits — 1 to 60 of { old, new }");
  const b = await loadBoard(ctx, opts.tabId, await agentOf(ctx, session));
  let text = b.design.files[opts.file];
  if (text === undefined) throw new Error(b.design.boards[opts.file]?.pending ? `${opts.file} is planned but not drawn yet: draw it with speca.designWrite.` : `No artboard ${opts.file}. Boards: ${b.design.order.join(", ")}.`);
  const problems: string[] = [];
  opts.edits.forEach((e, i) => {
    if (typeof e?.old !== "string" || !e.old || typeof e.new !== "string") { problems.push(`edit ${i + 1}: needs \`old\` and \`new\` strings`); return; }
    const n = text!.split(e.old).length - 1;
    if (n === 0) problems.push(`edit ${i + 1}: \`old\` not found (read the file with speca.designRead)`);
    else if (n > 1 && !e.all) problems.push(`edit ${i + 1}: \`old\` occurs ${n} times — make it unique or set "all": true`);
    else text = e.all ? text!.split(e.old).join(e.new) : text!.replace(e.old, () => e.new);
  });
  if (problems.length) throw new Error(`Nothing was changed.\n${problems.join("\n")}`);
  b.design.files[opts.file] = text!;
  await save(ctx, b, b.design, opts.note?.trim() || `${b.design.boards[opts.file]?.title ?? opts.file}: ${opts.edits.length} edit(s)`);
  await focus(ctx, b, opts.file);
  return { text: `${opts.file}: ${opts.edits.length} edit(s) applied.${alikeNote(alikeNotes(opts.file, text!))}` };
}
