// "Connections", as in Speca (core/web/views/connections.ts): a grid of cards, one per system the agent works in for the
// person — icon, name, status, two lines of what it is, its accounts, and in the footer what the agent gets and the one
// action. On Hyper's data: the model subscriptions (llm.listAccounts), Google accounts (google.accounts), and every
// plugin whose access is a key (its declared secret settings — the key is kept by Hyper, never shown to agents).
import { html, join, type Raw } from "./html.ts";
import * as k from "./ui/kit.ts";
import { ic } from "./ui/icons.ts";
import { putSetting } from "./settings.ts";
import type { Ctx } from "./route.ts";

type Acc = { name: string; ok: boolean; meta?: string };
type Card = { id: string; icon: string; name: string; desc: string; st: [string, string]; accounts: Acc[]; tools: number; foot: Raw };

const ICON: Record<string, string> = { brave: "search", pipedrive: "briefcase", research: "book", telegram: "send", google: "mail", zulip: "chatDots", whatsapp: "phone", gh: "pr" };
const NAME: Record<string, string> = { brave: "Brave Search", pipedrive: "Pipedrive", research: "Research", telegram: "Telegram", google: "Google", gh: "GitHub" };

/** Plugins whose access is a key: their declared secret settings, grouped, with Hyper's description and functions. */
async function keyed(c: Ctx) {
  const decl = ((await safe(() => c.h.fns.settings.declared({}))) as any[]).filter((d) => d.descriptor?.type === "secret");
  const plugins = new Map(((await safe(() => c.h.fns.plugins.list({}))) as any[]).map((p) => [String(p.name), p]));
  const by = new Map<string, any[]>();
  for (const d of decl) if (plugins.has(d.module) && d.module !== "speca") by.set(d.module, [...(by.get(d.module) ?? []), d]);
  return [...by.entries()].map(([module, keys]) => ({ module, keys, plugin: plugins.get(module) }));
}

/** A Hyper function may answer at once or later, and may throw: an empty list then. */
const safe = async (f: () => unknown): Promise<any[]> => { try { const v = await f(); return Array.isArray(v) ? v : []; } catch { return []; } };
const isSet = (d: any) => d.currentValue != null && d.currentValue !== "";

export async function connectionsHtml(c: Ctx): Promise<Raw> {
  const t = c.t;
  const cards: Card[] = [];
  // model subscriptions: Claude, ChatGPT, Kimi — signed in on Hyper's own settings page
  const accounts = (await safe(() => c.h.fns.llm.listAccounts({}))) as any[];
  const subs: Array<[string, string, RegExp, string]> = [["claude", "Claude", /claude|anthropic/, "claude"], ["chatgpt", "ChatGPT", /codex|openai/, "bot"], ["kimi", "Kimi Code", /kimi/, "bot"]];
  for (const [id, name, re, icon] of subs) {
    const xs = accounts.filter((a) => re.test(String(a.provider)));
    if (!xs.length && id === "kimi") continue;
    const ok = xs.filter((a) => !a.needsReconnect);
    cards.push({ id, icon, name, desc: t(`cn.d.${id}` as never), accounts: xs.map((a) => ({ name: a.label || a.account, ok: !a.needsReconnect, meta: a.needsReconnect ? t("conn.needsSignIn") : a.usedPercent != null ? t("my.used", { n: Math.round(a.usedPercent) }) : "" })),
      st: ok.length ? ["ok", ok.length > 1 ? t("conn.st.accounts", { n: ok.length }) : t("conn.st.on")] : xs.length ? ["bad", t("conn.needsSignIn")] : ["", t("conn.st.off")], tools: 0,
      foot: k.button({ label: xs.length ? t("my.manageSubs") : t("plugins.connect"), icon: xs.length ? "settings" : "plug", variant: "outline", size: "sm", href: "/settings" }) });
  }
  // Google: the accounts Hyper holds tokens for; a new one is authorized by the agent (google.reauth opens the sign-in)
  if (c.h.fns.google?.accounts) {
    const g = ((await safe(() => c.h.fns.google.accounts({}))) as any[]).map((a) => (typeof a === "string" ? a : a?.account ?? a?.email ?? String(a)));
    const fnN = (((await safe(() => c.h.fns.plugins.list({}))) as any[]).find((p) => p.name === "google")?.functions ?? 0);
    cards.push({ id: "google", icon: "mail", name: "Google", desc: t("cn.d.google"), accounts: g.map((name) => ({ name, ok: true })), tools: fnN,
      st: g.length ? ["ok", g.length > 1 ? t("conn.st.accounts", { n: g.length }) : t("conn.st.on")] : ["", t("conn.st.off")],
      foot: html`<form method="post" action="/speca/s" style="display:contents"><input type="hidden" name="title" value="Google"><input type="hidden" name="text" value="${t("cn.googleAsk")}">${k.button({ label: g.length ? t("conn.addAccount") : t("plugins.connect"), icon: g.length ? "plus" : "plug", variant: "outline", size: "sm", type: "submit" })}</form>` });
  }
  // plugins with a key
  for (const x of await keyed(c)) {
    const set = x.keys.every(isSet);
    const fixed = x.keys.some((d: any) => d.source === "file" || d.source === "env");
    const fromDb = x.keys.some((d: any) => d.source === "db");
    cards.push({ id: x.module, icon: ICON[x.module] ?? "plug", name: NAME[x.module] ?? String(x.plugin?.label || x.module), desc: String(x.plugin?.description ?? x.keys[0]?.descriptor?.description ?? ""),
      accounts: [], tools: Number(x.plugin?.functions ?? 0),
      st: set ? ["ok", fixed && !fromDb ? t("cn.byInstance") : t("conn.st.on")] : x.keys.some(isSet) ? ["bad", t("conn.st.incomplete")] : ["", t("conn.st.off")],
      foot: html`${fromDb ? k.button({ label: t("conn.remove"), variant: "ghost", size: "sm", attrs: html`hx-post="/speca/connections/${x.module}/remove" hx-confirm="${t("conn.removeConfirm")}" hx-swap="none"` }) : ""}${k.button({ label: set ? t("cn.changeKey") : t("plugins.connect"), icon: set ? "key" : "plug", variant: "outline", size: "sm", attrs: html`data-dialog="/speca/connections/${x.module}/key"` })}` });
  }
  const card = (x: Card) => html`<article class="conn-card" data-plugin="${x.id}">
    <header class="cc-h"><span class="pi">${ic(x.icon)}</span><div class="cc-t"><b>${x.name}</b><span class="cc-st"><i class="dot ${x.st[0]}"></i>${x.st[1]}</span></div></header>
    <p class="cc-d" title="${x.desc}">${x.desc}</p>
    ${x.accounts.length ? html`<div class="rows cc-acc">${join(x.accounts.map((a) => html`<div class="row-i"><i class="dot ${a.ok ? "ok" : "bad"}"></i><span class="row-t"><span class="t">${a.name}</span></span><span class="row-m${a.ok ? "" : " bad"}">${a.meta ?? ""}</span></div>`))}</div>` : ""}
    <footer class="cc-f"><span class="cc-tools">${x.tools ? t("conn.toolsShort", { n: x.tools }) : ""}</span><span class="grow"></span>${x.foot}</footer>
  </article>`;
  return html`<div class="doc day" id="conns"><div class="day-h"><div class="grow"><h2>${t("sb.connections")}</h2><div class="day-sub">${t("conn.sub")}</div></div>${k.button({ label: t("sb.plugins"), icon: "puzzle", variant: "outline", size: "sm", href: "/speca/plugins" })}</div>
    <div class="conn-grid">${join(cards.map(card))}</div>
    ${!cards.length ? html`<div class="day-empty">${ic("plug")}<span>${t("conn.none")}</span></div>` : ""}
    <p class="ver-hint">${t("conn.safety")}</p></div>`;
}

/** The dialog to enter a plugin's key(s): one password field per secret setting; an empty one keeps the value there is. */
export async function keyDialog(c: Ctx, module: string): Promise<Raw> {
  const t = c.t;
  const x = (await keyed(c)).find((p) => p.module === module);
  if (!x) throw new Error(t("common.notFound"));
  const fields = x.keys.map((d: any) => k.field({ label: String(d.descriptor?.title ?? d.key), hint: d.source === "file" ? t("cn.fixedByFile") : String(d.descriptor?.description ?? ""),
    control: k.input({ name: d.key, type: "password", autocomplete: "new-password", placeholder: isSet(d) ? t("plugins.secretSet") : t("plugins.secretNotSet"), attrs: html`spellcheck="false" data-1p-ignore data-lpignore="true"` }) }));
  return k.dialog({ icon: ICON[module] ?? "key", title: NAME[module] ?? String(x.plugin?.label || module), sub: t("conn.keyHint"), closeLabel: t("common.close"),
    form: html`hx-post="/speca/connections/${module}/key" hx-swap="none"`, body: join(fields),
    footRight: html`${k.button({ label: t("common.cancel"), variant: "outline", size: "sm", attrs: html`data-act="close-dialog" onclick="this.closest('dialog')?.close()"` })}${k.button({ label: t("common.save"), size: "sm", type: "submit" })}` });
}

export async function saveKey(c: Ctx, module: string): Promise<number> {
  const x = (await keyed(c)).find((p) => p.module === module);
  if (!x) throw new Error(c.t("common.notFound"));
  const f = await c.form();
  let n = 0;
  for (const d of x.keys) {
    const v = (f[d.key] ?? "").trim();
    if (!v) continue;
    if (/[\r\n]/.test(v)) throw new Error(c.t("conn.keyInvalid"));
    await putSetting(c, module, d.key, v, true);
    n++;
  }
  return n;
}

export async function removeKeys(c: Ctx, module: string): Promise<void> {
  const x = (await keyed(c)).find((p) => p.module === module);
  if (!x) throw new Error(c.t("common.notFound"));
  for (const d of x.keys) if (d.source === "db") await c.h.fns.settings.remove({ module, scopeType: "global", key: d.key }).catch(() => {});
}
