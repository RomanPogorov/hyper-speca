// "Plugins", as in Speca (core/web/routes/plugins.ts): a dialog — a header band (whose plugins, how many are on, a
// filter), a list with search on the left (on / off), the chosen one on the right: its switch, what it gives the agent
// (functions, routes, a skill), its connection (a key, for plugins whose access is one). On Hyper's plugins:
// plugins.list, procs.modules.list for the function names, plugins.offFor / plugins.setEnabled — per person, so on an
// instance without accounts every plugin is on for everybody and the switch says so.
import { html, join, type Raw } from "./html.ts";
import * as k from "./ui/kit.ts";
import type { Ctx } from "./route.ts";

const ICON: Record<string, string> = {
  brave: "search", websearch: "search", pipedrive: "briefcase", research: "book", arxiv: "book", medsearch: "book", telegram: "send", whatsapp: "phone", zulip: "chatDots",
  google: "mail", gh: "pr", browser: "globe", desktop: "monitor", duckdb: "table", excalidraw: "penTool", reladraw: "penTool", mermaid: "layout", vegalite: "gauge",
  svg: "image", nanobanana: "image", vision: "eye", pdf: "fileText", marker: "fileText", mineru: "fileText", tts: "headphones", whisper: "mic", youtube: "play",
  rss: "inbox", news: "megaphone", hackernews: "megaphone", substack: "megaphone", tasks: "listChecks", inbox: "inbox", knowledge: "bookmark", speca: "sparkle",
  gcs: "folder", gplaces: "compass", flow: "activity", telemetry: "activity", icons: "star", humanizer: "pencil", hyperhub: "grid", hyperlet: "grid", "architecture-map": "layers",
};
const icon = (name: string) => ICON[name] ?? "puzzle";
const safe = async (f: () => unknown): Promise<any[]> => { try { const v = await f(); return Array.isArray(v) ? v : []; } catch { return []; } };

export async function pluginsDialog(c: Ctx): Promise<Raw> {
  const t = c.t;
  const sel = c.url.searchParams.get("sel");
  const q = (c.url.searchParams.get("q") ?? "").trim();
  const all = (await safe(() => c.h.fns.plugins.list({}))).filter((p) => p.name !== "speca").sort((a, b) => String(a.label || a.name).localeCompare(String(b.label || b.name)));
  const off = new Set((await safe(() => c.h.fns.plugins.offFor({}))).map(String));
  const owner = String(await Promise.resolve(c.h.fns.auth.ownerId({})).catch(() => "") ?? "");
  const match = (p: any) => !q || `${p.label} ${p.name} ${p.description}`.toLowerCase().includes(q.toLowerCase());
  const shown = all.filter(match);
  const cur = all.find((p) => p.name === sel) ?? shown[0] ?? all[0];
  const qs = encodeURIComponent(q);
  const item = (p: any) => k.row({
    tag: "a", href: `/speca/plugins?sel=${p.name}&q=${qs}`, lead: k.iconTile(icon(p.name)), current: p.name === cur?.name, off: off.has(p.name) && p.name !== cur?.name,
    title: String(p.label || p.name), meta: t("conn.toolsShort", { n: Number(p.functions ?? 0) }), right: off.has(p.name) ? k.status({ tone: "off", text: t("plugins.off") }) : undefined,
    attrs: html`hx-get="/speca/plugins?sel=${p.name}&q=${qs}" hx-target="#dlg-body"`,
  });
  const on = shown.filter((p) => !off.has(p.name)), offs = shown.filter((p) => off.has(p.name));
  const group = (label: string, xs: any[]) => xs.length ? html`<div class="panel-group">${k.secLabel(label, { count: xs.length })}${k.rows(xs.map(item))}</div>` : "";
  return k.splitDialog({
    icon: "puzzle", title: t("plugins.title", { name: c.user.name }), sub: t("pl.sub", { on: all.length - off.size, all: all.length }), closeLabel: t("common.close"), detailId: "plDetail",
    list: html`${k.search({ name: "q", value: q, placeholder: t("plugins.search"), id: "plQ", autofocus: !c.hx, attrs: html`hx-get="/speca/plugins?sel=${cur?.name ?? ""}" hx-trigger="input changed delay:250ms" hx-target="#dlg-body"` })}
      ${group(t("plugins.installed"), on)}${group(t("plugins.off"), offs)}${!shown.length ? k.emptyLine(t("plugins.none")) : ""}`,
    detail: cur ? await detail(c, cur, !off.has(cur.name), !!owner) : k.emptyLine(t("plugins.none")),
  });
}

async function detail(c: Ctx, p: any, on: boolean, perPerson: boolean): Promise<Raw> {
  const t = c.t;
  const mod = (await safe(() => c.h.fns.procs.modules.list({}))).find((m) => m.name === p.name);
  const fns: string[] = (mod?.fns ?? []).map(String);
  const secrets = (await safe(() => c.h.fns.settings.declared({}))).filter((d) => d.module === p.name);
  const keyed = secrets.filter((d) => d.descriptor?.type === "secret");
  const set = keyed.length && keyed.every((d) => d.currentValue != null && d.currentValue !== "");
  const state = on ? t("plugins.on2") : t("plugins.off2");
  const toggle = k.switch({ checked: on, aria: state, attrs: perPerson
    ? html`hx-post="/speca/plugins/${p.name}/toggle" hx-vals='${JSON.stringify({ on: on ? "0" : "1" })}' hx-target="#dlg-body"`
    : html`disabled title="${t("pl.noUsers")}"` });
  const head = k.setHead({ lead: k.iconTile(icon(p.name), 44), title: String(p.label || p.name), meta: k.status({ tone: on ? "ok" : "off", text: state, meta: `${p.source === "user" ? t("pl.mine") : t("plugins.builtin")} · ${p.name}` }), sub: String(p.description ?? ""), actions: toggle });
  const short = (xs: string[], n = 14) => `${xs.slice(0, n).join(" · ")}${xs.length > n ? ` · +${xs.length - n}` : ""}`;
  const adds = k.section({ icon: "layers", title: t("plugins.adds"), body: k.rows([
    fns.length ? k.row({ icon: "zap", title: t("pl.functions"), meta: short(fns.map((f) => f.replace(/^.*\./, ""))), right: String(fns.length) }) : "",
    Number(p.routes) ? k.row({ icon: "appWindow", title: t("pl.routes"), right: String(p.routes) }) : "",
    p.hasSkill ? k.row({ icon: "sparkle", title: t("pl.skill"), meta: t("pl.skillHint") }) : "",
    (p.domains ?? []).length ? k.row({ icon: "globe", title: t("pl.domains"), meta: short((p.domains as any[]).map(String), 8) }) : "",
  ].filter(Boolean) as Raw[], { divided: true }) });
  const conn = keyed.length ? k.section({ icon: "plug", title: t("plugins.connection"),
    actions: k.button({ label: set ? t("cn.changeKey") : t("plugins.connect"), icon: set ? "key" : "plug", variant: "outline", size: "sm", attrs: html`data-dialog="/speca/connections/${p.name}/key"` }),
    body: k.status({ tone: set ? "ok" : "off", text: set ? t("conn.st.on") : t("conn.st.off") }) }) : "";
  const note = perPerson ? "" : html`<p class="ver-hint">${t("pl.noUsers")}</p>`;
  return html`<div class="set-stack">${head}${adds}${conn}${note}</div>`;
}

export async function togglePlugin(c: Ctx, name: string): Promise<void> {
  const f = await c.form();
  await c.h.fns.plugins.setEnabled({ plugin: name, enabled: f.on === "1" });
}
