// What the agent changed in its workspace folder, per turn (Speca core runtime/changes.ts): the folder is snapshotted
// as a git tree at the turn's start and end — in a private index and object store of the chat (.runtime/speca/
// snapshots/<agent>), the repo's objects only read as alternates — so the person's repo, index, refs and earlier
// uncommitted work are never touched. A folder without git gets a shadow repo in the same store. Turns are kept in
// speca_turn_changes; the hooks agent.turnStart / agent.turnEnd (Hyper's agent loop) take the snapshots.
import { posix } from "node:path";
import type { Host } from "./host.ts";

export type FileChange = { path: string; status: "A" | "M" | "D" | "R"; add: number; del: number; from?: string };
type Store = { h: Host; dir: string; store: string; repo: string | null };
type Db = { fns: { procs: { db: { select(o: { sql: string; params?: unknown[] }): Promise<unknown>; run(o: { sql: string; params?: unknown[] }): Promise<unknown> } } } };

const sel = async <R>(ctx: Db, sql: string, params: unknown[] = []) => (await ctx.fns.procs.db.select({ sql, params })) as R[];

// the folders a snapshot never looks into in a folder without git (with git, its own .gitignore decides)
const SKIP = ["node_modules/", ".next/", "dist/", "build/", ".turbo/", ".cache/", "coverage/", ".venv/", "__pycache__/", "*.log", ".runtime/"];

async function git(h: Host, args: string[], o: { cwd: string; env?: Record<string, string>; input?: string }): Promise<{ ok: boolean; out: string; bytes: Uint8Array }> {
  // the bytes as they are: no line-ending conversion from the person's config (core.autocrlf), which would make a
  // snapshot differ from the file and a revert not byte for byte
  const r = await h.exec(["git", "-c", "core.autocrlf=false", "-c", "core.safecrlf=false", ...args], { cwd: o.cwd, env: { GIT_TERMINAL_PROMPT: "0", ...o.env }, ...(o.input !== undefined ? { stdin: o.input } : {}) });
  return { ok: r.code === 0, out: new TextDecoder().decode(r.stdout), bytes: r.stdout };
}

async function storeFor(agentId: string, h: Host, dir: string): Promise<Store> {
  const store = h.dataDir("snapshots", agentId.replace(/[^\w.-]/g, "_"));
  await h.mkdir(posix.join(store, "objects"));
  const top = await git(h, ["rev-parse", "--show-toplevel"], { cwd: dir });
  return { h, dir, store, repo: top.ok ? top.out.trim() : null };
}

/** The env that makes git write objects into the chat's store and read the repo's as alternates. */
async function envOf(s: Store, index: string): Promise<Record<string, string>> {
  if (s.repo) {
    const common = await git(s.h, ["rev-parse", "--git-common-dir"], { cwd: s.repo });
    const gd = common.ok ? posix.resolve(s.repo, common.out.trim()) : posix.join(s.repo, ".git");
    const objs = posix.join(gd, "objects");
    return { GIT_INDEX_FILE: index, GIT_OBJECT_DIRECTORY: posix.join(s.store, "objects"), GIT_ALTERNATE_OBJECT_DIRECTORIES: (await s.h.stat(objs)) ? objs : "" };
  }
  // no git: a shadow repo in the store, the folder as its work tree
  const gd = posix.join(s.store, "shadow.git");
  if (!(await s.h.stat(posix.join(gd, "HEAD")))) {
    await git(s.h, ["init", "-q"], { cwd: s.dir, env: { GIT_DIR: gd } });
    await s.h.write(posix.join(gd, "info", "exclude"), SKIP.join("\n") + "\n");
  }
  return { GIT_DIR: gd, GIT_WORK_TREE: s.dir, GIT_INDEX_FILE: index, GIT_OBJECT_DIRECTORY: posix.join(s.store, "objects") };
}

/** The folder as a tree, now. */
async function treeOf(s: Store, name: string): Promise<string | null> {
  // our own index, kept in the store: its stat cache makes `add` rehash only what changed since the last snapshot
  const index = posix.join(s.store, `index-${name}`);
  const env = await envOf(s, index), cwd = s.repo ?? s.dir;
  if (!(await git(s.h, ["add", "--all", "--", "."], { cwd, env })).ok) return null;
  const t = await git(s.h, ["write-tree"], { cwd, env });
  return t.ok ? t.out.trim() : null;
}

export type Snap = { s: Store; tree: string };

/** Remember the folder at a turn's start. */
export async function snapshotStart(agentId: string, h: Host, dir: string): Promise<Snap | null> {
  try {
    const s = await storeFor(agentId, h, dir);
    const tree = await treeOf(s, "before");
    return tree ? { s, tree } : null;
  } catch { return null; }
}

/** At the turn's end: what differs from the start — kept, and returned for the chat's card. */
export async function snapshotEnd(ctx: Db, agentId: string, turnId: string, start: Snap, author: string | null = null): Promise<{ files: FileChange[]; added: number; removed: number } | null> {
  const after = await treeOf(start.s, "after").catch(() => null);
  if (!after || after === start.tree) return null;
  const env = await envOf(start.s, posix.join(start.s.store, "index-after")), cwd = start.s.repo ?? start.s.dir;
  const num = await git(start.s.h, ["diff-tree", "-r", "-M", "--numstat", "-z", start.tree, after], { cwd, env });
  const st = await git(start.s.h, ["diff-tree", "-r", "-M", "--name-status", start.tree, after], { cwd, env });
  if (!num.ok || !st.ok) return null;
  const status = new Map<string, FileChange["status"]>();
  for (const line of st.out.split("\n").filter(Boolean)) { const [k, ...p] = line.split("\t"); status.set(p[p.length - 1]!, (k![0] as FileChange["status"]) ?? "M"); }
  // -z numstat: "add\tdel\tpath\0" or, for a rename, "add\tdel\t\0from\0to\0"
  const parts = num.out.split("\0"), files: FileChange[] = [];
  for (let i = 0; i < parts.length; i++) {
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(parts[i]!);
    if (!m) continue;
    let path = m[3]!, from: string | undefined;
    if (!path) { from = parts[++i]; path = parts[++i]!; }
    files.push({ path, status: from ? "R" : status.get(path) ?? "M", add: m[1] === "-" ? 0 : Number(m[1]), del: m[2] === "-" ? 0 : Number(m[2]), ...(from ? { from } : {}) });
  }
  if (!files.length) return null;
  const added = files.reduce((n, f) => n + f.add, 0), removed = files.reduce((n, f) => n + f.del, 0);
  await ctx.fns.procs.db.run({ sql: `INSERT INTO speca_turn_changes (agent_id, turn_id, dir, store, before_tree, after_tree, files, added, removed, author) VALUES (?,?,?,?,?,?,?::jsonb,?,?,?)
    ON CONFLICT (agent_id, turn_id) DO UPDATE SET after_tree = excluded.after_tree, files = excluded.files, added = excluded.added, removed = excluded.removed`,
    params: [agentId, turnId, start.s.dir, start.s.store, start.tree, after, JSON.stringify(files), added, removed, author] });
  return { files, added, removed };
}

type Row = { dir: string; store: string; before_tree: string; after_tree: string; turn_id: string; files: FileChange[] | string; added: number; removed: number; created_at: string | Date; author: string | null };
const filesOf = (r: Row): FileChange[] => (typeof r.files === "string" ? JSON.parse(r.files) : r.files) ?? [];
const rowsOf = (ctx: Db, agentId: string, turnId?: string, desc = false) => sel<Row>(ctx,
  `SELECT dir, store, before_tree, after_tree, turn_id, files, added, removed, created_at, author FROM speca_turn_changes WHERE agent_id = ? ${turnId ? "AND turn_id = ?" : ""} ORDER BY created_at ${desc ? "DESC" : ""}`, turnId ? [agentId, turnId] : [agentId]);

/** One file of a turn (or of the whole chat: from the first turn's start to the last turn's end), before and after. */
export async function fileVersions(ctx: Db, agentId: string, h: Host, path: string, o: { turnId?: string }): Promise<{ before: string | null; after: string | null } | null> {
  const rows = await rowsOf(ctx, agentId, o.turnId);
  if (!rows.length) return null;
  const first = rows[0]!, last = rows[rows.length - 1]!;
  const s = await storeFor(agentId, h, first.dir);
  const env = await envOf(s, posix.join(s.store, "index-after")), cwd = s.repo ?? s.dir;
  const show = async (tree: string) => { const r = await git(h, ["cat-file", "-p", `${tree}:${path}`], { cwd, env }); return r.ok ? r.out : null; };
  return { before: await show(first.before_tree), after: await show(last.after_tree) };
}

/** The turns of a chat that changed files (newest first), and the whole chat's files. */
export async function chatChanges(ctx: Db, agentId: string): Promise<{ turns: Array<{ turnId: string; files: FileChange[]; added: number; removed: number; at: Date; author: string | null }>; all: FileChange[] }> {
  const rows = await rowsOf(ctx, agentId, undefined, true);
  const all = new Map<string, FileChange>();
  for (const r of [...rows].reverse()) for (const f of filesOf(r)) {
    const prev = all.get(f.path);
    all.set(f.path, prev ? { ...f, status: prev.status === "A" ? "A" : f.status, add: prev.add + f.add, del: prev.del + f.del } : { ...f });
  }
  return { turns: rows.map((r) => ({ turnId: r.turn_id, files: filesOf(r), added: Number(r.added), removed: Number(r.removed), at: new Date(r.created_at), author: r.author })), all: [...all.values()] };
}

/** A file's blob and mode in a snapshot tree; null when the tree does not have it. */
async function entryAt(s: Store, env: Record<string, string>, tree: string, path: string): Promise<{ id: string; mode: string } | null> {
  const ls = await git(s.h, ["ls-tree", "-z", tree, "--", path], { cwd: s.repo ?? s.dir, env });
  const m = /^(\d+) blob ([0-9a-f]+)\t/.exec(ls.out);
  return ls.ok && m ? { id: m[2]!, mode: m[1]! } : null;
}

export type RevertResult = { reverted: string[]; conflicts: string[] };

/** Put the files a turn (or the whole chat) changed back as they were before it — only if each is still exactly as
 *  the turn left it; otherwise nothing is written and the files changed since are named. */
export async function revertChanges(ctx: Db, agentId: string, h: Host, o: { turnId?: string; paths?: string[] }): Promise<RevertResult | null> {
  const rows = await rowsOf(ctx, agentId, o.turnId);
  if (!rows.length) return null;
  const s = await storeFor(agentId, h, rows[0]!.dir);
  const before = rows[0]!.before_tree, after = rows[rows.length - 1]!.after_tree;
  // the paths in play: both sides of a rename
  const all = new Set<string>();
  for (const r of rows) for (const f of filesOf(r)) { all.add(f.path); if (f.from) all.add(f.from); }
  const paths = o.paths?.length ? [...all].filter((p) => o.paths!.includes(p) || rows.some((r) => filesOf(r).some((f) => f.from === p && o.paths!.includes(f.path)))) : [...all];
  const plan: Array<{ path: string; abs: string; to: { id: string; mode: string } | null }> = [];
  const conflicts: string[] = [];
  const env = await envOf(s, posix.join(s.store, "index-after")), cwd = s.repo ?? s.dir;
  // the file now, as a snapshot would see it (the repo's attributes applied, like `add`)
  const idNow = async (path: string, abs: string) => (await h.stat(abs)) ? (await git(h, ["hash-object", `--path=${path}`, "--", abs], { cwd, env })).out.trim() : null;
  for (const path of paths) {
    const abs = posix.resolve(s.dir, path);
    if (!abs.startsWith(posix.resolve(s.dir) + "/")) continue;
    const [was, left, now] = await Promise.all([entryAt(s, env, before, path), entryAt(s, env, after, path), idNow(path, abs)]);
    // already as before (reverted earlier, or changed back): nothing to do
    if (now === (was?.id ?? null)) continue;
    // changed again since the turn: not ours to overwrite
    if (now !== (left?.id ?? null)) { conflicts.push(path); continue; }
    plan.push({ path, abs, to: was });
  }
  if (conflicts.length) return { reverted: [], conflicts };
  for (const x of plan) {
    if (!x.to) { await h.remove(x.abs); continue; }
    // the bytes as a checkout would write them (the repo's attributes; none → exactly as snapshotted)
    const r = await git(h, ["cat-file", "--filters", `--path=${x.path}`, x.to.id], { cwd, env });
    if (!r.ok) throw new Error(`could not read ${x.path} from the snapshot`);
    await h.write(x.abs, r.bytes, x.to.mode === "100755" ? { mode: 0o755 } : undefined);
  }
  return { reverted: plan.map((x) => x.path), conflicts: [] };
}
