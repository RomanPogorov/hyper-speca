// The person's settings, as Speca draws them (core/web/routes/settings.ts): a page with its own nav on the left —
// Profile, Models, My agent (access), Routines, Connections — on Hyper's data:
//   profile, theme, rules and defaults of my agent → speca_user.settings (web/hyper.ts saveSettings);
//   models → llm.listModels / llm.listAccounts, the default model and API keys → Hyper's declared settings, the
//            person's own value when the instance has users (settings.setMine), the instance's when it has none;
//   routines → Hyper's cron tasks named speca.routine.* that start a chat with the prompt (speca.routineRun).
import { html, join, type Raw } from "./html.ts";
import * as k from "./ui/kit.ts";
import { ic } from "./ui/icons.ts";
import { plainPage } from "./views/layout.ts";
import { appShim, models as listModels, saveSettings } from "./hyper.ts";
import { prettyModel } from "./types.ts";
import type { Ctx } from "./route.ts";

export const ROUTINE = "speca.routine.";

/** The settings page: the nav on the left (this page marked), the body on the right. */
export function setPage(c: Ctx, title: string, active: string, body: Raw): Raw {
  const t = c.t;
  const nav: Array<[string, string, string]> = [
    ["/speca/settings", "user", t("set.profile")], ["/speca/settings/models", "cpu", t("set.models")], ["/speca/settings/access", "shield", t("my.title")],
    ["/speca/settings/routines", "clock", t("set.routines")], ["/speca/connections", "plug", t("sb.connections")],
  ];
  return plainPage(appShim, t, title, html`<div class="settings">
    <nav class="set-nav"><a class="back" href="/speca" id="set-back">${ic("chevRight", "ic-sm flip")}${appShim.config.branding.productName}</a>
      ${join(nav.map(([href, i, l]) => html`<a href="${href}" aria-current="${active === href}">${ic(i, "ic-sm")}${l}</a>`))}
      <div class="set-h">Hyper</div><a href="/settings">${ic("settings", "ic-sm")}${t("my.hyperSettings")}</a><a href="/plugins">${ic("puzzle", "ic-sm")}${t("sb.plugins")}</a></nav>
    <main class="set-main">${body}</main></div>`, { wide: true, csrf: c.csrf });
}

const sel = (name: string, cur: string, opts: Array<[string, string]>) => k.select({ name, value: cur, options: opts });

// ── profile ─────────────────────────────────────────────────────────────
export function profilePage(c: Ctx): Raw {
  const { t, user: me } = c;
  return setPage(c, t("set.profile"), "/speca/settings", html`${k.setHead({ title: t("set.profile"), sub: t("set.profileSub", { product: appShim.config.branding.productName }) })}<div class="set-stack">
    ${k.section({ icon: "user", title: t("set.aboutMe"), form: html`method="post" action="/speca/settings/profile"`, body: html`
      ${k.fieldRow(k.field({ label: t("setup.name"), control: k.input({ name: "name", value: me.name }) }), k.field({ label: t("setup.title2"), control: k.input({ name: "title", value: me.title ?? "" }) }))}
      ${k.fieldRow(k.field({ label: t("setup.language"), control: sel("locale", me.locale ?? "ru", [["ru", "Русский"], ["en", "English"]]) }), k.field({ label: t("setup.tz"), control: k.input({ name: "tz", value: me.tz ?? appShim.config.org.timezone }) }))}
      ${k.field({ label: t("set.theme"), control: sel("theme", me.settings.theme ?? "system", ["system", "light", "dark"].map((x) => [x, t(`set.theme.${x}` as never)])) })}
      ${k.checkbox({ name: "msg_rail", value: "1", label: t("set.msgRail"), hint: t("set.msgRailHint"), checked: !!me.settings.msgRail })}`,
      foot: k.button({ label: t("common.save"), size: "sm", type: "submit" }) })}
  </div>`);
}

export async function saveProfile(c: Ctx): Promise<void> {
  const f = await c.form();
  const tz = (f.tz ?? "").trim();
  let okTz = true;
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); } catch { okTz = false; }
  await saveSettings(c.h, c.user.id, {
    name: (f.name ?? "").trim().slice(0, 80) || undefined, title: (f.title ?? "").trim().slice(0, 80) || null,
    locale: f.locale === "en" ? "en" : "ru", ...(tz && okTz ? { tz } : {}),
    theme: f.theme === "light" || f.theme === "dark" ? f.theme : "system", msgRail: f.msg_rail === "1",
  } as any);
}

// ── my agent: its rules, the access new chats start with, irreversible actions ─────────────────────────────
const LEVELS = ["read_only", "ask", "drafts", "full"] as const;

export function accessPage(c: Ctx): Raw {
  const { t, user: me } = c;
  const s = me.settings as any;
  const cur = LEVELS.includes(s.defaultAutonomy) ? s.defaultAutonomy : "full";
  return setPage(c, t("my.title"), "/speca/settings/access", html`${k.setHead({ title: t("my.title"), sub: t("my.sub") })}<div class="set-stack">
    ${k.section({ icon: "bot", title: t("my.rules"), hint: t("my.rulesHint"), form: html`method="post" action="/speca/settings/agent"`, body: html`
      ${k.textarea({ name: "rules", rows: 5, value: String(s.agentRules ?? ""), placeholder: t("my.rulesPh") })}`,
      foot: k.button({ label: t("common.save"), size: "sm", type: "submit" }) })}
    ${k.section({ icon: "shield", title: t("my.autonomy"), hint: t("my.autonomyHint"), form: html`method="post" action="/speca/settings/agent"`, body: html`
      <input type="hidden" name="part" value="access">
      ${k.choices({ name: "autonomy", type: "radio", items: LEVELS.map((v) => ({ value: v, label: t(`autonomy.${v}` as never), hint: t(`autonomy.${v}.hint` as never), checked: v === cur })) })}
      ${k.fieldGroup({ label: t("my.irreversible"), hint: t("my.irreversibleHint"), body: k.choices({ name: "noAskIrreversible", items: [{ value: "1", label: t("my.noAskIrreversible"), checked: s.askIrreversible === false }] }) })}`,
      foot: k.button({ label: t("common.save"), size: "sm", type: "submit" }) })}
  </div>`);
}

export async function saveAgent(c: Ctx): Promise<void> {
  const fd = await c.formAll();
  if (fd.get("part") === "access") {
    const v = String(fd.get("autonomy") ?? "");
    await saveSettings(c.h, c.user.id, { ...(LEVELS.includes(v as any) ? { defaultAutonomy: v } : {}), askIrreversible: fd.get("noAskIrreversible") !== "1" } as any);
  } else await saveSettings(c.h, c.user.id, { agentRules: String(fd.get("rules") ?? "").slice(0, 4000) } as any);
}

// ── models: subscriptions, the default, my API keys ──────────────────────────────────────────────────────
const KEYS: Array<[string, string]> = [["anthropicApiKey", "Anthropic"], ["openaiApiKey", "OpenAI"], ["openrouterApiKey", "OpenRouter"], ["kimiApiKey", "Kimi"], ["groqApiKey", "Groq"], ["cursorApiKey", "Cursor"]];

/** Whose a value is: the person's own when the instance has people, the instance's otherwise. */
const ownerOf = async (c: Ctx): Promise<string> => String(await c.h.fns.auth.ownerId({}).catch(() => "") ?? "");

async function getSetting(c: Ctx, module: string, key: string): Promise<unknown> {
  return c.h.fns.settings.get({ module, scopeType: "global", key }).catch(() => undefined);
}
export async function putSetting(c: Ctx, module: string, key: string, value: unknown, secret = false): Promise<void> {
  if (await ownerOf(c)) await c.h.fns.settings.setMine({ module, key, value });
  else await c.h.fns.settings.set({ module, scopeType: "global", key, value, isSecret: secret });
}

export async function modelsPage(c: Ctx): Promise<Raw> {
  const { t } = c;
  const all = await listModels(c.h);
  const accounts = (await c.h.fns.llm.listAccounts({}).catch(() => [])) as any[];
  const def = String(await getSetting(c, "llm", "defaultModel") ?? "");
  const shared = !(await ownerOf(c));
  const keys = await Promise.all(KEYS.map(async ([key, label]) => ({ key, label, set: !!(await getSetting(c, "llm", key)) })));
  const used = (a: any) => a.usedPercent == null ? "" : t("my.used", { n: Math.round(a.usedPercent) });
  const accRows = accounts.map((a) => k.row({ icon: /claude|anthropic/.test(a.provider) ? "claude" : "bot", title: a.label || a.account,
    meta: [providerName(a.provider), a.planType ?? "", a.needsReconnect ? "" : used(a)].filter(Boolean).join(" · "),
    right: k.status(a.needsReconnect ? { tone: "bad", text: t("conn.needsSignIn") } : a.available ? { tone: "ok", text: t("conn.st.on") } : { tone: "attention", text: t("my.exhausted") }) }));
  const opts: Array<[string, string]> = all.map((m) => [m.ref, m.label]);
  if (def && !opts.some(([r]) => r === def)) opts.unshift([def, prettyModel(def)]);
  return setPage(c, t("set.models"), "/speca/settings/models", html`${k.setHead({ title: t("set.models"), sub: t("my.modelsSub") })}<div class="set-stack">
    ${k.section({ icon: "cpu", title: t("wel.defaultModel"), form: html`method="post" action="/speca/settings/default-model"`,
      body: opts.length ? sel("model", def, opts) : k.emptyLine(t("my.noModels")), foot: opts.length ? k.button({ label: t("common.save"), size: "sm", type: "submit" }) : undefined })}
    ${k.section({ icon: "key", title: t("my.subs"), hint: t("my.subsHint"), actions: k.button({ label: t("my.manageSubs"), variant: "ghost", size: "sm", href: "/settings" }),
      body: accRows.length ? k.rows(accRows, { divided: true }) : k.emptyLine(t("my.noSubs")) })}
    ${k.section({ icon: "key", title: t("my.keys"), hint: shared ? t("my.keysShared") : t("my.keysHint"), form: html`method="post" action="/speca/settings/keys"`,
      body: join(pairs(keys.map((x) => k.field({ label: x.label, control: k.input({ name: x.key, type: "password", placeholder: x.set ? t("plugins.secretSet") : t("plugins.secretNotSet"), autocomplete: "new-password", attrs: html`spellcheck="false" data-1p-ignore data-lpignore="true"` }) }))).map((p) => k.fieldRow(...p))),
      foot: k.button({ label: t("common.save"), size: "sm", type: "submit" }) })}
    ${k.section({ icon: "building", title: t("models.all"), body: all.length ? k.rows(groupBy(all.map((m) => [m.sourceId, prettyModel(m.model)] as [string, string])).map(([src, ms]) => k.row({ icon: "cpu", title: providerName(src), meta: ms.join(", ") })), { divided: true }) : k.emptyLine(t("my.noModels")) })}
  </div>`);
}

const providerName = (p: string) => {
  const [base, acc] = p.split("/");
  const name: Record<string, string> = { "anthropic-oauth": "Claude", "claude-code": "Claude Code", anthropic: "Anthropic API", openai: "OpenAI", "openai-codex": "ChatGPT", codex: "ChatGPT", openrouter: "OpenRouter", "kimi-coding": "Kimi Code", kimi: "Kimi", mock: "Mock" };
  return `${name[base!] ?? base}${acc && acc !== "default" ? ` (${acc})` : ""}`;
};
const pairs = <X>(xs: X[]): X[][] => xs.reduce<X[][]>((a, x, i) => (i % 2 ? a[a.length - 1]!.push(x) : a.push([x]), a), []);
function groupBy(xs: Array<[string, string]>): Array<[string, string[]]> {
  const m = new Map<string, string[]>();
  for (const [a, b] of xs) m.set(a, [...(m.get(a) ?? []), b]);
  return [...m.entries()];
}

export async function saveDefaultModel(c: Ctx): Promise<void> {
  const v = ((await c.form()).model ?? "").trim();
  if (!v) return;
  await putSetting(c, "llm", "defaultModel", v);
  await saveSettings(c.h, c.user.id, { defaultModel: v } as any);
}

export async function saveKeys(c: Ctx): Promise<number> {
  const f = await c.form();
  let n = 0;
  for (const [key] of KEYS) {
    const v = (f[key] ?? "").trim();
    if (!v) continue;
    if (/\s/.test(v) || !/^[\x21-\x7e]+$/.test(v)) throw new Error(c.t("conn.keyInvalid"));
    await putSetting(c, "llm", key, v, true);
    n++;
  }
  return n;
}

// ── routines: the agent's work on a schedule ──────────────────────────────────────────────────────────
type When = { id: string; hh: number; mm: number; every: "1d" | "7d"; dow?: number; days?: number[] };
const WHEN: When[] = [
  { id: "weekdays8", hh: 8, mm: 0, every: "1d", days: [1, 2, 3, 4, 5] },
  { id: "daily9", hh: 9, mm: 0, every: "1d" },
  { id: "friday18", hh: 18, mm: 0, every: "7d", dow: 5 },
];

/** The next moment it is hh:mm (on that weekday) in the time zone, as epoch ms. */
export function nextAt(w: { hh: number; mm: number; dow?: number }, tz: string, now = Date.now()): number {
  const parts = (ms: number) => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const offset = (ms: number) => { const p = parts(ms); return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!) - Math.floor(ms / 60000) * 60000; };
  for (let d = 0; d < 9; d++) {
    const p = parts(now + d * 86400_000);
    const local = Date.UTC(+p.year!, +p.month! - 1, +p.day!, w.hh, w.mm);
    const at = local - offset(local);
    const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday!);
    if (at > now && (w.dow == null || dow === w.dow)) return at;
  }
  return now + 86400_000;
}

export async function routinesPage(c: Ctx): Promise<Raw> {
  const { t, user: me } = c;
  const tz = me.tz ?? appShim.config.org.timezone;
  const list = ((await c.h.fns.cron.list({ limit: 500 }).catch(() => [])) as any[]).filter((x) => String(x.name).startsWith(ROUTINE));
  const fmt = (ms: number) => new Date(ms).toLocaleString(c.t.locale === "ru" ? "ru-RU" : "en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const args = (x: any) => (typeof x.args === "string" ? JSON.parse(x.args) : x.args ?? {});
  const rows = list.map((x) => {
    const a = args(x);
    const when = WHEN.find((w) => w.id === a.when);
    const last = x.lastStatus ? ` · ${t("my.lastRun", { st: x.lastStatus === "ok" || x.lastStatus === "done" ? "✓" : String(x.lastStatus) })}` : "";
    return k.row({ icon: "clock", title: String(a.title || a.prompt?.slice(0, 60) || x.name), meta: `${when ? t(`set.${when.id}` as never) : ""} · ${tz} · ${x.enabled ? t("set.nextRun", { at: fmt(Number(x.nextRunAt)) }) : t("set.off")}${last}`, actionsAlways: true,
      actions: html`${k.button({ label: t("set.runNow"), variant: "outline", size: "sm", attrs: html`hx-post="/speca/routines/${x.name.slice(ROUTINE.length)}/run" hx-swap="none"` })}${k.button({ icon: "x", variant: "ghost", size: "icon-sm", tooltip: t("conn.remove"), attrs: html`hx-post="/speca/routines/${x.name.slice(ROUTINE.length)}/delete" hx-swap="none"` })}` });
  });
  return setPage(c, t("set.routines"), "/speca/settings/routines", html`${k.setHead({ title: t("set.routines"), sub: t("set.routinesSub") })}<div class="set-stack">
    ${k.section({ icon: "clock", title: t("set.myRoutines"), body: rows.length ? k.rows(rows, { divided: true }) : k.emptyLine(t("set.noRoutines")) })}
    ${k.section({ icon: "plus", title: t("set.newRoutine"), form: html`method="post" action="/speca/routines"`, body: html`
      ${k.field({ label: t("set.routineTitle"), control: k.input({ name: "title", value: t("set.briefTitle") }) })}
      ${k.field({ label: t("set.routinePrompt"), control: k.textarea({ name: "prompt", rows: 4, value: t("set.briefPrompt") }) })}
      ${k.field({ label: t("set.when"), control: sel("when", "weekdays8", WHEN.map((w) => [w.id, t(`set.${w.id}` as never)])) })}`,
      footHint: t("my.tzNote", { tz }), foot: k.button({ label: t("set.addRoutine"), size: "sm", type: "submit" }) })}
  </div>`);
}

export async function addRoutine(c: Ctx): Promise<void> {
  const f = await c.form();
  const w = WHEN.find((x) => x.id === f.when) ?? WHEN[0]!;
  const prompt = (f.prompt ?? "").trim().slice(0, 4000);
  if (!prompt) throw new Error(c.t("my.noPrompt"));
  const tz = c.user.tz ?? appShim.config.org.timezone;
  const name = `${ROUTINE}${Date.now().toString(36)}`;
  await c.h.fns.cron.add({ name, fn: "speca.routineRun", every: w.every, args: { title: (f.title ?? "").trim().slice(0, 120), prompt, when: w.id, tz, days: w.days ?? null, userId: c.user.id } });
  // the first run at that time of day (the interval keeps it there)
  await c.h.fns.procs.db.run({ sql: "UPDATE cron_tasks SET next_run_at = ? WHERE name = ?", params: [nextAt(w, tz), name] });
}

export async function runRoutine(c: Ctx, id: string): Promise<void> {
  const [x] = ((await c.h.fns.cron.list({ name: `${ROUTINE}${id}` })) as any[]);
  if (!x) throw new Error(c.t("common.notFound"));
  const a = typeof x.args === "string" ? JSON.parse(x.args) : x.args ?? {};
  await c.h.fns.speca.routineRun({ ...a, force: true });
}

export async function removeRoutine(c: Ctx, id: string): Promise<void> {
  await c.h.fns.cron.remove({ name: `${ROUTINE}${id}` });
}
