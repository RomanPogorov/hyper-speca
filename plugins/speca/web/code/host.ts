// The machine a chat's project folder is on, as Speca's code runtime sees it (core runtime/host.ts): run a program,
// read, write and list files, a data folder of its own. Hyper's workspace can be on an SSH host; Speca's snapshots
// and Files tab work on this machine only for now — a remote workspace is "no code project" here.
import { mkdir, readdir, readFile, rename, rm, stat, writeFile, realpath } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

export type Host = {
  id: "local";
  exec(argv: string[], o?: { cwd?: string; env?: Record<string, string>; stdin?: string }): Promise<{ code: number; stdout: Uint8Array; stderr: string }>;
  stat(p: string): Promise<{ kind: "file" | "dir"; size: number; version: string } | null>;
  read(p: string): Promise<Uint8Array>;
  write(p: string, data: string | Uint8Array, o?: { mode?: number }): Promise<void>;
  mkdir(p: string): Promise<void>;
  rename(a: string, b: string): Promise<void>;
  remove(p: string): Promise<void>;
  readdir(p: string): Promise<Array<{ name: string; dir: boolean }>>;
  dataDir(...parts: string[]): string;
};

/** Speca's own data on this machine: next to Hyper's runtime files, never in the person's project. */
const DATA = resolve(process.cwd(), ".runtime", "speca");

export const localHost: Host = {
  id: "local",
  async exec(argv, o = {}) {
    const p = Bun.spawn(argv, { cwd: o.cwd, env: { ...process.env, ...o.env }, stdin: o.stdin !== undefined ? new TextEncoder().encode(o.stdin) : "ignore", stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(p.stdout).arrayBuffer(), new Response(p.stderr).text(), p.exited]);
    return { code, stdout: new Uint8Array(out), stderr: err };
  },
  async stat(p) {
    const s = await stat(p).catch(() => null);
    if (!s) return null;
    return { kind: s.isDirectory() ? "dir" : "file", size: s.size, version: `${s.size}:${Math.round(s.mtimeMs)}` };
  },
  async read(p) { return new Uint8Array(await readFile(p)); },
  async write(p, data, o) { await mkdir(dirname(p), { recursive: true }); await writeFile(p, data, o?.mode ? { mode: o.mode } : undefined); },
  async mkdir(p) { await mkdir(p, { recursive: true }); },
  async rename(a, b) { await mkdir(dirname(b), { recursive: true }); await rename(a, b); },
  // one file, or an empty-or-not folder the person asked to delete from the Files tab
  async remove(p) { await rm(p, { recursive: true, force: true }); },
  async readdir(p) { return (await readdir(p, { withFileTypes: true }).catch(() => [])).map((e) => ({ name: e.name, dir: e.isDirectory() })); },
  dataDir: (...parts) => join(DATA, ...parts),
};

/** Is `abs` inside `root`, links resolved (what does not exist yet: its nearest existing parent)? */
export async function inside(root: string, abs: string): Promise<boolean> {
  const real = async (p: string): Promise<string> => { try { return await realpath(p); } catch { const up = dirname(p); return up === p ? p : join(await real(up), p.slice(up.length + 1)); } };
  const r = await real(resolve(root)), a = await real(resolve(abs));
  return a === r || a.startsWith(r + sep);
}
