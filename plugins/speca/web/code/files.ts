// The Files tab of a code project (Speca core runtime/project-files.ts): the whole workspace folder, browsed, read
// and edited by the person. Every path goes through the gate (inside the folder, links resolved); a person's write is
// snapshotted like a turn (so it shows in the changes and can be reverted), shows in the chat as a card, and is told
// to the agent before its next turn (speca_note → agent.promptAugment), as canvas hand edits are.
import { extname, posix, resolve } from "node:path";
import { inside, localHost, type Host } from "./host.ts";
import { snapshotStart, snapshotEnd, revertChanges, type RevertResult } from "./changes.ts";

/** What a listing never shows, git or not. */
const HIDE = new Set([".git", "node_modules", ".DS_Store"]);
const SKIP_DIRS = new Set([...HIDE, ".next", "dist", "build", ".turbo", ".cache", "coverage", ".venv", "__pycache__"]);
export const MAX_FILES = 20_000;
export const MAX_TEXT = 1_500_000;
const IMAGES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon", ".bmp": "image/bmp", ".svg": "image/svg+xml" };

export class FilesError extends Error { constructor(public code: "outside" | "missing" | "exists" | "changed" | "invalid", msg: string) { super(msg); } }

type H = { fns: any };

/** The chat's code project: its agent's workspace folder on this machine (a remote workspace: none, for now). */
export async function codeDir(ctx: H, agentId: string): Promise<{ dir: string; h: Host } | null> {
  const r = ((await ctx.fns.procs.db.select({ sql: "SELECT workspace_dir, workspace_host FROM agents WHERE id = ?", params: [agentId] })) as Array<{ workspace_dir: string | null; workspace_host: string | null }>)[0];
  if (!r?.workspace_dir || r.workspace_host) return null;
  const dir = resolve(r.workspace_dir.replace(/^~(?=\/|$)/, process.env.HOME ?? "~"));
  return (await localHost.stat(dir))?.kind === "dir" ? { dir, h: localHost } : null;
}

/** A path the person gave, relative to the folder, checked by the gate. */
export async function pathIn(dir: string, rel: string): Promise<string> {
  const clean = String(rel ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean || clean.split("/").some((p) => p === ".." || p === ".git")) throw new FilesError("invalid", `bad path: ${rel}`);
  const abs = posix.join(dir, clean);
  if (!(await inside(dir, abs))) throw new FilesError("outside", `${rel} is outside the project folder`);
  return abs;
}

/** Every file of the folder (paths relative to it): with git, what git tracks or would (its .gitignore decides). */
export async function listFiles(h: Host, dir: string): Promise<{ files: string[]; truncated: boolean }> {
  const r = await h.exec(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: dir, env: { GIT_TERMINAL_PROMPT: "0" } }).catch(() => null);
  let files: string[];
  if (r && r.code === 0) {
    const gone = await h.exec(["git", "ls-files", "--deleted", "-z"], { cwd: dir }).catch(() => null);
    const del = new Set(gone && gone.code === 0 ? new TextDecoder().decode(gone.stdout).split("\0").filter(Boolean) : []);
    files = [...new Set(new TextDecoder().decode(r.stdout).split("\0").filter(Boolean))].filter((f) => !del.has(f) && !f.split("/").some((x) => HIDE.has(x)));
  } else {
    files = [];
    const walk = async (rel: string) => {
      if (files.length > MAX_FILES) return;
      for (const e of await h.readdir(rel ? `${dir}/${rel}` : dir)) {
        const p = rel ? `${rel}/${e.name}` : e.name;
        if (e.dir) { if (!SKIP_DIRS.has(e.name)) await walk(p); }
        else if (!HIDE.has(e.name) && !e.name.endsWith(".log")) files.push(p);
      }
    };
    await walk("");
  }
  files.sort();
  return { files: files.slice(0, MAX_FILES), truncated: files.length > MAX_FILES };
}

export const versionOf = (bytes: Uint8Array) => new Bun.CryptoHasher("sha1").update(bytes).digest("hex");

export type FileView =
  | { kind: "text"; content: string; version: string; size: number }
  | { kind: "image"; mime: string; size: number; version: string }
  | { kind: "binary" | "large"; size: number; version: string };

/** One file for the viewer: its text, or what it is when it can't be shown as text. */
export async function readProjectFile(h: Host, dir: string, rel: string): Promise<FileView> {
  const abs = await pathIn(dir, rel);
  const st = await h.stat(abs);
  if (!st) throw new FilesError("missing", `${rel} does not exist`);
  if (st.kind !== "file") throw new FilesError("missing", `${rel} is not a file`);
  const img = IMAGES[extname(abs).toLowerCase()];
  if (st.size > MAX_TEXT) return { kind: img ? "image" : "large", ...(img ? { mime: img } : {}), size: st.size, version: st.version } as FileView;
  const bytes = await h.read(abs);
  const version = versionOf(bytes);
  if (img && img !== "image/svg+xml") return { kind: "image", mime: img, size: st.size, version };
  if (bytes.subarray(0, 8000).includes(0)) return { kind: "binary", size: st.size, version };
  return { kind: "text", content: new TextDecoder().decode(bytes), version, size: st.size };
}

/** The raw bytes, for an image preview or a download. */
export async function rawProjectFile(h: Host, dir: string, rel: string): Promise<{ bytes: Uint8Array; mime: string; name: string }> {
  const abs = await pathIn(dir, rel);
  if ((await h.stat(abs))?.kind !== "file") throw new FilesError("missing", `${rel} does not exist`);
  return { bytes: await h.read(abs), mime: IMAGES[extname(abs).toLowerCase()] ?? "application/octet-stream", name: abs.split("/").pop()! };
}

export type PersonOp =
  | { op: "save"; path: string; content: string; version: string }
  | { op: "create"; path: string; folder?: boolean }
  | { op: "rename"; path: string; to: string }
  | { op: "delete"; path: string };

/** A note for the agent, read before its next turn (one per key until delivered). */
export async function noteForAgent(ctx: H, agentId: string, key: string, text: string) {
  await ctx.fns.procs.db.run({ sql: "INSERT INTO speca_note (agent_id, key, text) VALUES (?,?,?) ON CONFLICT (agent_id, key) DO UPDATE SET text = excluded.text, created_at = now()", params: [agentId, key, text] });
}

/** The chat's card for a person's change (the same as a turn's). */
async function card(ctx: H, agentId: string, turnId: string, author: string, ch: { files: unknown[]; added: number; removed: number }, more: Record<string, unknown> = {}) {
  await ctx.fns.session.appendEvent({ id: agentId, event: { type: "turn_changes", turnId, by: author, ...more, files: ch.files.slice(0, 300), more: Math.max(0, ch.files.length - 300), added: ch.added, removed: ch.removed } });
}

/** A person's own change to the project folder: done, snapshotted, shown in the chat, and told to the agent. */
export async function personEdit(ctx: H, h: Host, o: { agentId: string; userId: string; dir: string }, x: PersonOp): Promise<{ files: number; version?: string }> {
  const abs = await pathIn(o.dir, x.path);
  const to = x.op === "rename" ? await pathIn(o.dir, x.to) : null;
  const exists = async (p: string) => (await h.stat(p)) !== null;
  // check before touching anything
  if (x.op === "save") {
    if (await exists(abs)) {
      const bytes = await h.read(abs);
      if (versionOf(bytes) !== x.version) throw new FilesError("changed", `${x.path} changed on disk since it was opened`);
      if (new TextDecoder().decode(bytes) === x.content) return { files: 0, version: x.version };
    } else if (x.version) throw new FilesError("changed", `${x.path} was deleted since it was opened`);
  }
  if ((x.op === "create" && (await exists(abs))) || (to && (await exists(to)))) throw new FilesError("exists", `${x.op === "create" ? x.path : (x as { to: string }).to} already exists`);
  if ((x.op === "rename" || x.op === "delete") && !(await exists(abs))) throw new FilesError("missing", `${x.path} does not exist`);

  const snap = await snapshotStart(o.agentId, h, o.dir);
  if (x.op === "save") await h.write(abs, x.content);
  else if (x.op === "create") { if (x.folder) await h.mkdir(abs); else await h.write(abs, ""); }
  else if (x.op === "rename") await h.rename(abs, to!);
  else await h.remove(abs);

  const author = `user:${o.userId}`;
  const turnId = `edit_${Bun.randomUUIDv7()}`;
  const ch = snap ? await snapshotEnd(ctx, o.agentId, turnId, snap, author) : null;
  if (ch) await card(ctx, o.agentId, turnId, author, ch);
  const what = x.op === "save" ? `edited ${x.path}` : x.op === "create" ? `created ${x.folder ? "the folder " : ""}${x.path}` : x.op === "rename" ? `renamed ${x.path} to ${x.to}` : `deleted ${x.path}`;
  await noteForAgent(ctx, o.agentId, `file:${x.path}`, `The person ${what} by hand in the project's Files tab.${x.op === "save" ? " Re-read it before changing it." : ""}`);
  return { files: ch?.files.length ?? 0, ...(x.op === "save" ? { version: versionOf(await h.read(abs)) } : {}) };
}

/** The person puts a turn's (or the whole chat's) files back as they were — kept, shown and told like an edit. */
export async function personRevert(ctx: H, h: Host, o: { agentId: string; userId: string; dir: string }, x: { turnId?: string; paths?: string[] }): Promise<RevertResult | null> {
  const snap = await snapshotStart(o.agentId, h, o.dir);
  const r = await revertChanges(ctx, o.agentId, h, x);
  if (!r || r.conflicts.length || !r.reverted.length) return r;
  const author = `user:${o.userId}`;
  const turnId = `revert_${Bun.randomUUIDv7()}`;
  const ch = snap ? await snapshotEnd(ctx, o.agentId, turnId, snap, author) : null;
  if (ch) await card(ctx, o.agentId, turnId, author, ch, { revertOf: x.turnId ?? "all" });
  const list = r.reverted.slice(0, 20).join(", ") + (r.reverted.length > 20 ? `, … (${r.reverted.length})` : "");
  await noteForAgent(ctx, o.agentId, `revert:${turnId}`, `The person reverted ${x.turnId ? "a turn's" : "this chat's"} changes to ${list}: those files are back as they were before. Re-read them before changing them.`);
  return r;
}
