// The branch chip's menu (Speca core runtime/git.ts, write side, and its /s/:id/git/* routes): switch to a branch or
// make one, commit chosen files as the person, push the branch, open a pull request. Each action leaves a line in the
// chat (a "git" event) and tells the agent without waking it, so its next turn knows the folder moved.
// Push and pull requests go through the machine's own git and gh sign-ins.
import { html, join, type Raw } from "../html.ts";
import * as k from "../ui/kit.ts";
import { toast } from "../route.ts";
import { getSession } from "../hyper.ts";
import { codeDir } from "./files.ts";
import { gitState } from "./git.ts";
import type { Host } from "./host.ts";
import type { Ctx } from "../route.ts";

class GitError extends Error { constructor(public code: string, public detail = "") { super(code); } }

const git = async (h: Host, dir: string, args: string[], env: Record<string, string> = {}) => {
  const r = await h.exec(["git", ...args], { cwd: dir, env: { GIT_TERMINAL_PROMPT: "0", ...env } }).catch((e) => ({ code: 1, stdout: new Uint8Array(), stderr: String(e?.message ?? e) }));
  return { ok: r.code === 0, out: new TextDecoder().decode(r.stdout), err: r.stderr };
};

async function gitOf(c: Ctx) {
  const sid = c.params.id!;
  const s = await getSession(c.h, c.user.id, sid);
  if (!s) throw new Error(c.t("common.notFound"));
  const d = await codeDir(c.h, sid);
  if (!d) throw new Error(c.t("git.err.not_repo"));
  return { s, h: d.h as Host, dir: d.dir as string };
}

const fail = (c: Ctx, e: unknown) => {
  if (!(e instanceof GitError)) throw e;
  const key = `git.err.${e.code}`;
  return toast(c.t(key as never) === key ? c.t("git.err.failed") : c.t(key as never), e.detail.slice(0, 300), "error");
};

/** The chat's line and the agent's note (read on its next turn; it is not woken). */
async function note(c: Ctx, sid: string, d: Record<string, unknown>, text: string) {
  await c.h.fns.agent.deliver({ to: sid, type: "git", text, key: `git:${d.kind}:${Date.now()}`, source: "speca", author: `user:${c.user.id}`, wake: "none", event: { type: "git", ...d } }).catch(async () => {
    await c.h.fns.session.appendEvent({ id: sid, event: { type: "git", ...d } }).catch(() => {});
  });
}

export async function gitSwitchRoute(c: Ctx) {
  const { s, h, dir } = await gitOf(c);
  const f = await c.form();
  const name = String(f.name ?? "").trim(), create = f.create === "1";
  try {
    if (!name || !(await git(h, dir, ["check-ref-format", "--branch", name])).ok) throw new GitError("bad_name");
    const st = await gitState(h, dir);
    if (!st) throw new GitError("not_repo");
    if (create) {
      if (st.branches.includes(name)) throw new GitError("exists");
      const r = await git(h, dir, ["switch", "-c", name]);
      if (!r.ok) throw new GitError("failed", r.err);
    } else {
      // new files nobody added go along; changes to tracked ones block (they would travel or conflict)
      const tracked = st.changes.filter((x) => !x.untracked);
      if (tracked.length) throw new GitError("dirty", tracked.slice(0, 8).map((x) => x.path).join(", "));
      const r = await git(h, dir, ["switch", name]);
      if (!r.ok) throw new GitError("failed", r.err);
    }
  } catch (e) { return fail(c, e); }
  await note(c, s.id, { kind: create ? "branch" : "switch", branch: name }, create ? `The person created the branch ${name} and switched to it (uncommitted changes came along).` : `The person switched the project folder to the branch ${name}. Files may differ from what you read before.`);
  return toast(c.t(create ? "git.created" : "git.switched", { name }), "", "success", { "dh-close-dialog": true, "dh-live": true });
}

export async function gitBranchDialog(c: Ctx): Promise<Raw> {
  const t = c.t, sid = c.params.id!;
  return k.dialog({ size: "sm", icon: "branch", title: t("git.newBranch"), sub: t("git.newBranchSub"), closeLabel: t("common.close"), form: html`hx-post="/speca/s/${sid}/git/switch" hx-swap="none"`,
    body: html`<input type="hidden" name="create" value="1"><input class="input" name="name" required autofocus placeholder="feature/…" aria-label="${t("git.branchName")}">`,
    footLeft: k.button({ label: t("common.cancel"), variant: "ghost", attrs: html`data-act="close-dialog"` }),
    footRight: k.button({ label: t("git.create"), variant: "primary", type: "submit" }) });
}

/** A plain message from the files; the chat's last answer's first line when it says what was done. */
async function suggest(c: Ctx, sid: string, files: Array<{ path: string }>): Promise<string> {
  const names = files.map((f) => f.path.split("/").pop()!);
  return `Update ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}`;
}

export async function gitCommitDialog(c: Ctx): Promise<Raw> {
  const { s, h, dir } = await gitOf(c);
  const g = await gitState(h, dir);
  if (!g) throw new Error(c.t("git.err.not_repo"));
  const t = c.t;
  const files = join(g.changes.map((f) => html`<label class="git-file"><input type="checkbox" class="checkbox" name="files" value="${f.path}" checked><span class="chg-st st-${f.status ?? "M"}">${f.status ?? "M"}</span><span class="chg-name" title="${f.path}">${f.from ? `${f.from} → ` : ""}${f.path}</span></label>`));
  return k.dialog({ size: "md", icon: "check", title: t("git.commitTitle", { branch: g.branch ?? t("git.detached") }), sub: t("git.commitSub"), closeLabel: t("common.close"), cls: "git-dlg", form: html`hx-post="/speca/s/${s.id}/git/commit" hx-swap="none"`,
    body: html`<div class="git-msg"><textarea class="textarea" name="message" rows="4" required aria-label="${t("git.message")}">${await suggest(c, s.id, g.changes)}</textarea></div>
      <div class="git-files">${g.changes.length ? files : html`<div class="muted">${t("git.clean")}</div>`}</div>`,
    footLeft: k.button({ label: t("common.cancel"), variant: "ghost", attrs: html`data-act="close-dialog"` }),
    footRight: k.button({ label: t("git.commitDo"), variant: "primary", type: "submit" }) });
}

export async function gitCommitRoute(c: Ctx) {
  const { s, h, dir } = await gitOf(c);
  const fd = await c.formAll();
  const asked = fd.getAll("files").map(String);
  const message = String(fd.get("message") ?? "").trim();
  let sha = "";
  try {
    if (!message) throw new GitError("no_message");
    const st = await gitState(h, dir);
    if (!st) throw new GitError("not_repo");
    const known = new Set(st.changes.flatMap((x) => (x.from ? [x.path, x.from] : [x.path])));
    const files = asked.filter((f) => known.has(f));
    if (!files.length) throw new GitError("no_files");
    // a rename is committed as both its sides; what is on disk is added, what is gone is removed
    const paths = [...new Set(files.flatMap((f) => { const x = st.changes.find((y) => y.path === f); return x?.from ? [f, x.from] : [f]; }))];
    const here: string[] = [];
    for (const p of paths) if (await h.stat(`${dir}/${p}`)) here.push(p);
    const gone = paths.filter((p) => !here.includes(p));
    if (here.length) { const r = await git(h, dir, ["add", "-A", "--", ...here]); if (!r.ok) throw new GitError("failed", r.err); }
    if (gone.length) { const r = await git(h, dir, ["rm", "-q", "--cached", "--ignore-unmatch", "--", ...gone]); if (!r.ok) throw new GitError("failed", r.err); }
    const r = await git(h, dir, ["commit", "-q", "-m", message, "--", ...paths]);
    if (!r.ok) throw new GitError("failed", r.err);
    sha = (await git(h, dir, ["rev-parse", "--short", "HEAD"])).out.trim();
  } catch (e) { return fail(c, e); }
  const g = await gitState(h, dir);
  const subject = message.split("\n")[0]!;
  await note(c, s.id, { kind: "commit", sha, branch: g?.branch ?? null, message: subject, files: asked.length }, `The person committed ${asked.length} file(s) on ${g?.branch ?? "a detached HEAD"}: ${sha} "${subject}".`);
  return toast(c.t("git.committed", { sha }), subject, "success", { "dh-close-dialog": true, "dh-live": true });
}

export async function gitPushRoute(c: Ctx) {
  const { s, h, dir } = await gitOf(c);
  let branch = "";
  try {
    const st = await gitState(h, dir);
    if (!st?.branch) throw new GitError(st ? "detached" : "not_repo");
    if (!st.remote) throw new GitError("no_remote");
    branch = st.branch;
    const r = await git(h, dir, ["push", "--porcelain", "-u", "origin", `HEAD:refs/heads/${branch}`]);
    if (!r.ok) throw new GitError(/rejected|non-fast-forward|fetch first/i.test(r.err) ? "behind" : /Authentication|could not read|403|denied/i.test(r.err) ? "auth" : "failed", r.err.slice(0, 400));
  } catch (e) { return fail(c, e); }
  await note(c, s.id, { kind: "push", branch }, `The person pushed the branch ${branch} to origin.`);
  return toast(c.t("git.pushed", { branch }), "", "success", { "dh-live": true });
}

/** A pull request of the branch into the default one (or the one open already), with the machine's gh sign-in. */
export async function gitPrRoute(c: Ctx) {
  const { s, h, dir } = await gitOf(c);
  let pr: { url: string; number: number; title: string; existed: boolean };
  const gh = async (args: string[]) => {
    const r = await h.exec(["gh", ...args], { cwd: dir, env: { GH_PROMPT_DISABLED: "1" } }).catch((e) => ({ code: 127, stdout: new Uint8Array(), stderr: String(e?.message ?? e) }));
    return { ok: r.code === 0, out: new TextDecoder().decode(r.stdout), err: r.stderr };
  };
  try {
    const st = await gitState(h, dir);
    if (!st?.branch) throw new GitError(st ? "detached" : "not_repo");
    if (!st.github) throw new GitError("not_github");
    if (!st.upstream) throw new GitError("not_pushed");
    const open = await gh(["pr", "view", st.branch, "--json", "url,number,title,state"]);
    const cur = open.ok ? JSON.parse(open.out) : null;
    if (cur && cur.state === "OPEN") pr = { url: cur.url, number: cur.number, title: cur.title, existed: true };
    else {
      const made = await gh(["pr", "create", "--fill", "--head", st.branch, "--body", `From the chat “${s.title || st.branch}”.`]);
      if (!made.ok) throw new GitError(/auth|login|401|403/i.test(made.err) ? "auth" : /default branch|same as base/i.test(made.err) ? "on_default" : "failed", made.err.slice(0, 300));
      const url = made.out.trim().split("\n").pop() ?? "";
      const v = await gh(["pr", "view", url, "--json", "url,number,title"]);
      const p = v.ok ? JSON.parse(v.out) : { url, number: Number(/\/pull\/(\d+)/.exec(url)?.[1] ?? 0), title: s.title };
      pr = { url: p.url, number: p.number, title: p.title, existed: false };
    }
  } catch (e) { return fail(c, e); }
  const g = await gitState(h, dir);
  await note(c, s.id, { kind: "pr", url: pr.url, number: pr.number, branch: g?.branch ?? null, title: pr.title, existed: pr.existed }, `The person ${pr.existed ? "found the open" : "opened a"} pull request #${pr.number} for ${g?.branch}: ${pr.url}`);
  return toast(c.t(pr.existed ? "git.prExists" : "git.prOpened", { n: pr.number }), pr.url, "success", { "dh-live": true });
}
