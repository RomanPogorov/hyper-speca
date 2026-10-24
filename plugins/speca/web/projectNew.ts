// "New project", as in Speca (core/web/routes/app.ts /projects/new): the kind as radio cards — chats on a topic, a code
// folder of this machine, a GitHub repository cloned here — the name, the kind's own field; made with Hyper's
// project.create, then the first chat of the project opens. People and "my computer" (runners) are not part of this port.
import { html, type Raw } from "./html.ts";
import * as k from "./ui/kit.ts";
import { redirect } from "./route.ts";
import type { Ctx } from "./route.ts";

const home = () => process.env.HOME ?? "/tmp";
const codeRoot = () => `${home()}/Projects`;
const plainRoot = () => `${process.cwd()}/.runtime/projects`;

export function projectNewDialog(c: Ctx): Raw {
  const t = c.t;
  const kinds: Array<[string, string, string]> = [["plain", "msg", "proj.kind.plain"], ["folder", "folder", "proj.kind.folder"], ["repo", "branch", "proj.kind.repo"]];
  const code = html`autocomplete="off" spellcheck="false"`;
  const kindCards = k.choiceCards({ name: "kind", attrs: html`aria-label="${t("proj.new")}"`, items: kinds.map(([v, i, label], n) => ({ value: v, icon: i, label: t(label as never), hint: t(`${label}.hint` as never), checked: n === 0 })) });
  const repoHint = html`${t("proj.repoGh")} · ${t("proj.repoWhere", { dir: codeRoot().replace(home(), "~") })}`;
  return k.dialog({ size: "lg", icon: "folderPlus", title: t("proj.new"), sub: t("proj.newSub"), closeLabel: t("common.close"), cls: "proj-new",
    form: html`hx-post="/speca/projects" hx-swap="none" hx-disabled-elt="#pn-submit" hx-indicator="#pn-busy"`,
    body: html`${kindCards}
      ${k.field({ label: t("proj.name"), control: k.input({ name: "name", autofocus: true, placeholder: t("proj.namePh") }) })}
      <div class="pn-only pn-folder">${k.field({ label: t("proj.codeFolder"), control: k.input({ name: "workdir", placeholder: "~/Projects/my-app", attrs: code }) })}</div>
      <div class="pn-only pn-repo">${k.field({ label: t("proj.repo"), hint: repoHint, control: k.input({ name: "repo", placeholder: "owner/repo · https://github.com/owner/repo", attrs: code }) })}</div>`,
    footLeft: k.button({ label: t("common.cancel"), variant: "ghost", attrs: html`data-act="close-dialog"` }),
    footRight: html`<span class="pn-busy" id="pn-busy">${t("proj.cloning")}</span>${k.button({ label: t("proj.create"), type: "submit", attrs: html`id="pn-submit"` })}` });
}

/** A free lowerCamelCase slug from the name (Cyrillic spelled in Latin letters). */
async function slugFor(c: Ctx, name: string): Promise<string> {
  const lat: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
  const words = [...name.toLowerCase()].map((ch) => lat[ch] ?? ch).join("").split(/[^a-z0-9]+/).filter(Boolean);
  let base = words.map((w, i) => (i ? w[0]!.toUpperCase() + w.slice(1) : w)).join("").replace(/^[0-9]+/, "").slice(0, 50) || "project";
  for (let n = 1; ; n++) {
    const s = n === 1 ? base : `${base}${n}`;
    if (!(await c.h.fns.project.get({ slug: s }))) return s;
  }
}

const run = async (cmd: string[], cwd: string) => {
  try {
    const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1" } });
    const [code, err] = await Promise.all([p.exited, new Response(p.stderr).text()]);
    return { ok: code === 0, err };
  } catch (e: any) { return { ok: false, err: String(e?.message ?? e) }; }
};

export async function createProject(c: Ctx) {
  const t = c.t, f = await c.form();
  const kind = ["folder", "repo"].includes(String(f.kind)) ? String(f.kind) : "plain";
  let name = String(f.name ?? "").trim().slice(0, 120);
  let dir = "", createDir = false;
  if (kind === "folder") {
    const w = String(f.workdir ?? "").trim().replace(/^~(?=\/|$)/, home()).replace(/\/+$/, "");
    if (!w.startsWith("/")) throw new Error(t("proj.codeFolder"));
    dir = w; createDir = true;
    name ||= w.split("/").pop() ?? "";
  } else if (kind === "repo") {
    const m = /^(?:https?:\/\/github\.com\/|git@github\.com:)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(String(f.repo ?? "").trim());
    if (!m) throw new Error(t("proj.badRepo"));
    const [, owner, repo] = m;
    name ||= repo!;
    const root = codeRoot();
    await Bun.$`mkdir -p ${root}`.quiet().nothrow();
    let target = `${root}/${repo}`;
    for (let n = 2; await Bun.file(`${target}/.git/HEAD`).exists() || (await run(["test", "-e", target], root)).ok; n++) target = `${root}/${repo}-${n}`;
    let r = await run(["git", "clone", "--quiet", `https://github.com/${owner}/${repo}.git`, target], root);
    if (!r.ok) r = await run(["gh", "repo", "clone", `${owner}/${repo}`, target], root);
    if (!r.ok) throw new Error(`${/not found|access|denied|403|404/i.test(r.err) ? t("proj.repoAccess") : t("proj.cloneFailed")}${r.err ? ` — ${r.err.trim().split("\n").pop()}` : ""}`);
    dir = target;
  }
  if (!name) throw new Error(t("proj.needName"));
  const slug = await slugFor(c, name);
  if (kind === "plain") { dir = `${plainRoot()}/${slug}`; createDir = true; }
  const p = await c.h.fns.project.create({ slug, title: name, defaultDir: dir, createDir });
  try { c.h.fns.events.emitAgentsChanged({ reason: "project" }); } catch {}
  const made = await c.h.fns.agent.createFromValues({ title: "", projectId: p.id });
  if (made.error || !made.agent) return redirect(c, `/speca`);
  return redirect(c, `/speca/s/${made.agent.id}`);
}
