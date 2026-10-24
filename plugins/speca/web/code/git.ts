// The git state of a chat's folder, for the branch chip by the send button (Speca core runtime/git.ts, read side):
// the branch, its upstream and how far apart, the uncommitted files, the local branches.
import type { Host } from "./host.ts";
import type { GitState } from "../types.ts";

const run = async (h: Host, dir: string, args: string[]) => {
  const r = await h.exec(["git", ...args], { cwd: dir, env: { GIT_TERMINAL_PROMPT: "0" } }).catch(() => null);
  return r && r.code === 0 ? new TextDecoder().decode(r.stdout) : null;
};

/** The folder's branch alone (cheap: for the chat page's first paint). */
export async function branchOf(h: Host, dir: string): Promise<string | null> {
  const b = (await run(h, dir, ["rev-parse", "--abbrev-ref", "HEAD"]))?.trim();
  return b && b !== "HEAD" ? b : null;
}

/** The whole state, or null when the folder is no git repository. */
export async function gitState(h: Host, dir: string): Promise<GitState | null> {
  const st = await run(h, dir, ["status", "--porcelain=v1", "-b", "-z", "--untracked-files=all"]);
  if (st === null) return null;
  const [head = "", ...rest] = st.split("\0");
  // "## main...origin/main [ahead 1, behind 2]" or "## HEAD (no branch)"
  const m = /^## (?:No commits yet on )?([^.\s]+)(?:\.\.\.(\S+))?(?: \[(?:ahead (\d+))?(?:, )?(?:behind (\d+))?\])?/.exec(head);
  const detached = /^## HEAD \(no branch\)/.test(head);
  const changes: GitState["changes"] = [];
  for (let i = 0; i < rest.length; i++) {
    const e = rest[i]!; if (e.length < 4) continue;
    const xy = e.slice(0, 2), path = e.slice(3);
    if (xy[0] === "R" || xy[0] === "C") { changes.push({ path, status: "R", from: rest[++i] }); continue; }
    changes.push(xy === "??" ? { path, status: "A", untracked: true } : { path, status: xy.includes("D") ? "D" : xy.includes("A") ? "A" : "M" });
  }
  const branches = ((await run(h, dir, ["for-each-ref", "--format=%(refname:short)", "refs/heads"])) ?? "").split("\n").filter(Boolean);
  const remote = ((await run(h, dir, ["remote"])) ?? "").split("\n").filter(Boolean)[0] ?? null;
  const url = remote ? ((await run(h, dir, ["remote", "get-url", remote])) ?? "").trim() : "";
  return { branch: detached ? null : m?.[1] ?? null, detached, upstream: m?.[2] ?? null, ahead: Number(m?.[3] ?? 0), behind: Number(m?.[4] ?? 0), changes, branches, remote: !!remote, github: /github\.com[:/]/.test(url) };
}
