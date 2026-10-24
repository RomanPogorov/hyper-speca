// "My day", as in Speca (core/web/views/day.ts): a greeting with the date and what waits, the ask line (it goes to the
// person's coordinator chat), the morning brief (the latest run of their brief routine), then groups with one action
// per item — confirmations and plans to decide, Hyper's tasks, the chats whose agents finished or got stuck today.
// The coordinator: one chat of the person's own that the ask line writes to (colleagues are not part of this port).
import { html, type Raw } from "./html.ts";
import * as k from "./ui/kit.ts";
import { ic } from "./ui/icons.ts";
import { md } from "./md.ts";
import { clock, dateLong, hourIn, rel } from "./fmt.ts";
import { appShim, listSessions, saveSettings } from "./hyper.ts";
import { pending } from "./approvals.ts";
import { ROUTINE, nextAt } from "./settings.ts";
import type { Ctx } from "./route.ts";

const safe = async (f: () => unknown): Promise<any[]> => { try { const v = await f(); return Array.isArray(v) ? v : []; } catch { return []; } };
const argsOf = (x: any) => (typeof x.args === "string" ? JSON.parse(x.args) : x.args ?? {});

/** The person's coordinator chat: made the first time it is needed, kept in their settings. */
export async function coordinatorId(c: Ctx): Promise<string> {
  const id = String((c.user.settings as any).coordinatorId ?? "");
  if (id) {
    const [a] = await safe(() => c.h.fns.procs.db.select({ sql: "SELECT id FROM agents WHERE id = ? AND archived_at IS NULL", params: [id] }));
    if (a) return id;
  }
  const made = await c.h.fns.agent.createFromValues({ title: c.t("dy.coord"), projectId: "" });
  if (made.error || !made.agent) throw new Error(made.error ?? "could not start the coordinator");
  const nid = String(made.agent.id);
  await saveSettings(c.h, c.user.id, { coordinatorId: nid } as any);
  (c.user.settings as any).coordinatorId = nid;
  return nid;
}

/** The brief routine: the one marked as the brief, else the one with the brief's title. */
async function briefRoutine(c: Ctx) {
  const all = (await safe(() => c.h.fns.cron.list({ limit: 500 }))).filter((x) => String(x.name).startsWith(ROUTINE));
  return all.find((x) => argsOf(x).brief) ?? all.find((x) => argsOf(x).title === c.t("set.briefTitle")) ?? null;
}

export async function briefCard(c: Ctx): Promise<Raw> {
  const t = c.t;
  const tz = c.user.tz ?? appShim.config.org.timezone;
  const r = await briefRoutine(c);
  const a = r ? argsOf(r) : null;
  let text = "", at: Date | null = null, busy = false;
  if (a?.lastAgent) {
    const [row] = await safe(() => c.h.fns.procs.db.select({ sql: `SELECT a.run_state,
      (SELECT payload::jsonb->>'text' FROM events e WHERE e.agent_id = a.id AND e.type = 'assistant' AND coalesce(payload::jsonb->>'text','') <> '' ORDER BY idx DESC LIMIT 1) AS text,
      (SELECT ts FROM events e WHERE e.agent_id = a.id AND e.type = 'assistant' ORDER BY idx DESC LIMIT 1) AS at FROM agents a WHERE a.id = ?`, params: [a.lastAgent] }));
    text = String(row?.text ?? "");
    at = row?.at ? new Date(Number(row.at) || row.at) : null;
    busy = row?.run_state === "running";
  }
  const today = at ? dateLong(at, tz, t.locale) === dateLong(new Date(), tz, t.locale) : false;
  const when = at ? (today ? t("brief.at", { time: clock(at, tz) }) : t("brief.old", { date: dateLong(at, tz, t.locale) })) : "";
  const runAttrs = html`hx-post="/speca/brief/run" hx-target="#brief" hx-swap="outerHTML" ${busy ? "disabled" : ""}`;
  const actions = html`${r ? k.button({ label: t("brief.refresh"), icon: "refresh", variant: "ghost", size: "sm", attrs: runAttrs }) : ""}
    ${a?.lastAgent ? k.button({ label: t("brief.discuss"), icon: "msg", variant: "ghost", size: "sm", href: `/speca/s/${a.lastAgent}` }) : ""}
    ${k.button({ icon: "clock", variant: "ghost", size: "icon-sm", tooltip: t("set.routines"), href: "/speca/settings/routines" })}`;
  const status = busy ? k.status({ tone: "draft", text: t("brief.running") }) : when ? k.status({ tone: today ? "ok" : "off", text: when }) : "";
  const body = text ? html`${status}<div class="brief-body" data-open="false"><div class="md">${md(text)}</div></div><div>${k.button({ label: t("brief.more"), variant: "ghost", size: "sm", attrs: html`data-act="brief-more"` })}</div>`
    : busy ? html`${status}` : k.banner({ text: t("brief.none"), actions: k.button({ label: t("brief.make"), size: "sm", attrs: runAttrs }) });
  return k.panel({ icon: "sun", title: t("brief.title"), actions, body, attrs: html`id="brief" hx-get="/speca/f/brief" hx-trigger="dh-live${busy ? ", every 4s" : ""}" hx-swap="outerHTML"` });
}

/** "Refresh" / "Make it now": runs the brief routine, making it first (weekdays at 8:00) when there is none. */
export async function runBrief(c: Ctx): Promise<void> {
  let r = await briefRoutine(c);
  if (!r) {
    const tz = c.user.tz ?? appShim.config.org.timezone;
    const name = `${ROUTINE}${Date.now().toString(36)}`;
    await c.h.fns.cron.add({ name, fn: "speca.routineRun", every: "1d", args: { name, brief: true, title: c.t("set.briefTitle"), prompt: c.t("set.briefPrompt"), when: "weekdays8", tz, days: [1, 2, 3, 4, 5], userId: c.user.id } });
    await c.h.fns.procs.db.run({ sql: "UPDATE cron_tasks SET next_run_at = ? WHERE name = ?", params: [nextAt({ hh: 8, mm: 0 }, tz), name] });
    [r] = await safe(() => c.h.fns.cron.list({ name }));
  }
  await c.h.fns.speca.routineRun({ ...argsOf(r), name: r.name, force: true });
}

export async function dayHtml(c: Ctx): Promise<Raw> {
  const t = c.t, me = c.user;
  const tz = me.tz ?? appShim.config.org.timezone;
  const sm = (o: k.ButtonOpts) => k.button({ variant: "ghost", size: "sm", ...o });
  // to decide: confirmations, plans, questions of the person's agents
  const needs = await pending(c.h).catch(() => []);
  const decide = needs.map((n) => {
    const vals = (decision: string) => html`hx-post="/speca/approvals/${n.id}" hx-vals='${JSON.stringify({ hash: n.preview_hash, decision })}' hx-swap="none"`;
    const href = `/speca/s/${n.chat_id}${n.agent_id !== n.chat_id ? `?sub=${n.agent_id}` : ""}`;
    const acts = n.kind === "question" ? k.button({ label: t("tk.reply"), size: "sm", href })
      : html`${sm({ label: t("day.open"), href })}${sm({ label: t("appr.reject"), variant: "outline", attrs: vals("rejected") })}${k.button({ label: t("appr.do"), size: "sm", variant: n.effect === "irreversible" ? "destructive" : "primary", attrs: vals("approved") })}`;
    return k.row({ icon: n.effect === "irreversible" ? "alert" : n.kind === "question" ? "msg" : "shield", title: n.summary || t(`agents.need.${n.kind === "plan" ? "plan" : n.kind === "question" ? "question" : "approval"}` as never), meta: n.items.slice(0, 2).join(" · ") || undefined, actions: acts, actionsAlways: true });
  });
  // Hyper's tasks: open ones, with their chat when an agent took them
  const tasks = (await safe(() => c.h.fns.tasks?.list({}))).filter((x) => x.status !== "done").slice(0, 20).map((x) => k.row({
    icon: "listChecks", title: String(x.description ?? "").split("\n")[0]!.slice(0, 140), meta: x.status === "running" ? t("tk.st.run") : rel(new Date(Number(x.createdAt) || x.createdAt), t.locale), actionsAlways: true,
    actions: x.agentId ? sm({ label: t("day.continue"), href: `/speca/s/${x.agentId}` }) : html`${sm({ label: t("day.start"), variant: "outline", attrs: html`hx-post="/speca/tasks/${x.id}/start" hx-swap="none"` })}${k.button({ icon: "check", variant: "ghost", size: "icon-sm", tooltip: t("day.markDone"), side: "top", attrs: html`hx-post="/speca/tasks/${x.id}/done" hx-swap="none"` })}`,
  }));
  // results: chats whose agents finished or failed in the last day, not seen since
  const since = Date.now() - 24 * 3600_000;
  const results = (await listSessions(c.h, me.id, { limit: 200 })).filter((s) => s.kind !== "subagent" && s.id !== (me.settings as any).coordinatorId && (s.status === "idle" || s.status === "error")
    && s.updated_at.getTime() > since && (s.last_idx ?? -1) > (s.seen_idx ?? -1)).slice(0, 12)
    .map((s) => k.row({ icon: s.status === "error" ? "alert" : "sparkle", title: s.title || t("chat.newChat"), meta: `${s.status === "error" ? t("tk.st.bad") : t("tk.slot.last")} · ${rel(s.updated_at, t.locale)}`, actionsAlways: true,
      actions: html`<a class="btn" data-variant="ghost" data-size="sm" href="/speca/s/${s.id}">${t("day.open")}${ic("chevRight", "ic-xs")}</a>` }));
  const n = decide.length + tasks.length;
  const h = hourIn(tz);
  const first = me.name.split(/\s+/)[0] ?? me.name;
  const hi = t(h < 5 ? "day.night" : h < 12 ? "day.morning" : h < 18 ? "day.afternoon" : "day.evening", { name: first });
  const date = dateLong(new Date(), tz, t.locale);
  const grp = (title: string, rows: Raw[]) => rows.length ? k.pageSection({ title, count: rows.length, body: k.rows(rows, { divided: true }) }) : "";
  return html`<div class="doc day" id="day" hx-get="/speca/f/day" hx-trigger="dh-live, every 60s" hx-swap="outerHTML" data-live-topic="user:${me.id}">
    ${k.pageHead({ title: hi, sub: `${date.charAt(0).toUpperCase()}${date.slice(1)} · ${n ? t("day.waiting", { n }) : t("day.allClear")}` })}
    ${k.askBar({ name: "text", placeholder: t("dy.askPlaceholder"), aria: t("day.askAria"), sendLabel: t("composer.send"), cls: "day-ask", attrs: html`hx-post="/speca/coordinator/ask" hx-swap="none" data-reset` })}
    ${await briefCard(c)}
    ${n ? "" : k.empty({ icon: "check", text: t("dy.emptyHint") })}
    ${grp(t("day.g.decide"), decide)}
    ${grp(t("dy.tasks"), tasks)}
    ${grp(t("day.g.results"), results)}
  </div>`;
}

