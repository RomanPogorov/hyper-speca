import { mkdir, writeFile, stat } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";

/**
 * Writes a text file for the person (markdown, CSV, JSON, HTML, code, config…) and opens it in the file viewer with Download.
 *
 * Use it when the result is a file to keep or hand over. The file goes to the chat's folder (a new name: never over an
 * existing file — a number is added), or, in a chat without a folder, to Speca's own files on this machine.
 * Returns its path and the tab.
 * @param opts.name File name with extension, e.g. notes.md (a relative path inside the folder is fine: docs/plan.md).
 * @param opts.content The whole text of the file.
 * @param opts.open Open it on the canvas. @default true
 * @param opts.agentId Agent whose chat it is for. @default the current agent
 */

export default async function (ctx: Context, _session: Session | null, opts: {
  /** File name with extension, e.g. notes.md (or a relative path: docs/plan.md). */
  name: string;
  /** The whole text of the file. */
  content: string;
  /** Open it on the canvas. @default true */
  open?: boolean;
  /** Agent whose chat it is for. @default the current agent */
  agentId?: string;
}): Promise<{ path: string; tabId?: number; text: string }> {
  const name = String(opts.name ?? "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!name || name.length > 200 || name.split("/").some((p) => p === ".." || p === "" || p === ".git")) throw new Error("speca.writeFile: name — a file name like notes.md (a relative path is fine, no ..)");
  if (typeof opts.content !== "string" || opts.content.length > 2_000_000) throw new Error("speca.writeFile: content — the file's text, up to 2 MB");
  const agentId = String(opts.agentId ?? (await ctx.fns.agent.current({})).id);
  const ws = agentId ? ((await ctx.fns.procs.db.select({ sql: "SELECT workspace_dir, workspace_host FROM agents WHERE id = ?", params: [agentId] })) as any[])[0] ?? {} : {};
  const local = ws.workspace_dir && !ws.workspace_host ? resolve(String(ws.workspace_dir).replace(/^~(?=\/|$)/, process.env.HOME ?? "~")) : null;
  const base = local && (await stat(local).catch(() => null))?.isDirectory() ? local : resolve(process.cwd(), ".runtime", "speca", "files", agentId);
  // a new name, never over a file that is there
  const dot = name.lastIndexOf("."), stem = dot > name.lastIndexOf("/") ? name.slice(0, dot) : name, ext = dot > name.lastIndexOf("/") ? name.slice(dot) : "";
  let path = join(base, name);
  for (let n = 2; await stat(path).catch(() => null); n++) path = join(base, `${stem}-${n}${ext}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, opts.content);
  if (opts.open === false) return { path, text: `Wrote ${path}` };
  const tab: any = await ctx.fns.canvas.show({ kind: "speca.file", args: { path }, title: path.split("/").pop()!, ...(opts.agentId ? { agentId: opts.agentId } : {}) });
  return { path, tabId: tab?.id ?? tab?.itemId, text: `Wrote ${path}; opened in the viewer (tab ${tab?.id ?? tab?.itemId}).` };
}
