// The chat page and its parts, the way Speca draws them (core/web/routes/app.ts: chatCtx, chatPanel, sessionPage),
// on Hyper's agents. Route files call these; the views (views/*.ts) are Speca's own.
import { html, type Raw } from "./html.ts";
import { ic } from "./ui/icons.ts";
import type { EventRow } from "./types.ts";
import { appShim, getSession, loadEvents, models, setChat, type HSession } from "./hyper.ts";
import { chatHead, composer, emptyChat, logHtml, olderMark, queueDock, schedDock, type ChatCtx, type CodeCtx } from "./views/chat.ts";
import { codeDir } from "./code/files.ts";
import { branchOf } from "./code/git.ts";
import { shell } from "./views/layout.ts";
import { closedOf, sidebar } from "./views/sidebar.ts";
import { canvasHtml } from "./canvas.ts";
import type { Ctx } from "./route.ts";

// a chat opens on its last turns; older ones come a page at a time as the person scrolls up
export const FIRST_TURNS = 15, OLDER_TURNS = 20;
/** What makes a chat's log more than its empty state. */
export const shownInLog = (e: { type: string }) => ["turn_start", "user_message", "branch_merged", "side_question", "plan_usage"].includes(e.type);

/** The chat, or a "not found" error the route turns into a toast / page. */
export async function chatOf(c: Ctx): Promise<HSession> {
  const s = await getSession(c.h, c.user.id, c.params.id!);
  if (!s) throw new Error(c.t("common.notFound"));
  return s;
}

/** A chat whose agent works in a folder on this machine is a code project: Files and Changes tabs, the branch chip. */
export async function codeCtx(c: Ctx, sid: string): Promise<CodeCtx | null> {
  const code = await codeDir(c.h, sid);
  if (!code) return null;
  return { projectId: sid, dir: code.dir, repo: null, runner: null, computer: null, scripts: [], run: null, canRun: false, branch: await branchOf(code.h, code.dir) };
}

export async function chatCtx(c: Ctx, s: HSession): Promise<ChatCtx> {
  const forkOf = s.fork_idx != null && s.parent_id ? await getSession(c.h, c.user.id, s.parent_id) : null;
  return {
    app: appShim, t: c.t, me: c.user, s, owner: c.user, readonly: false, participant: false, preview: null,
    models: await models(c.h), tzone: c.user.tz ?? appShim.config.org.timezone, csrf: c.csrf, code: await codeCtx(c, s.id),
    forkOf: forkOf ? { id: forkOf.id, title: forkOf.title } : null, forks: [],
  };
}

/** The idx the log starts from to show the last `n` turns (before `before`), or the turn that holds `holding`. */
export function turnsFrom(events: EventRow[], n: number, o: { before?: number; holding?: number } = {}): number {
  const starts = events.filter((e) => e.type === "turn_start").map((e) => e.idx);
  if (o.holding != null) {
    const at = starts.filter((i) => i <= o.holding!).pop();
    return at ?? 0;
  }
  const list = o.before != null ? starts.filter((i) => i < o.before!) : starts;
  if (list.length <= n) return 0;
  return list[list.length - n]!;
}

export async function markSeen(c: Ctx, s: HSession, max: number): Promise<void> {
  if (max > s.seen_idx) await setChat(c.h, c.user.id, s.id, { seen_idx: max }).catch(() => undefined);
}

/** A subagent's own page: no composer — it works for its parent chat; a way back and Stop. */
async function subagentNote(c: Ctx, s: HSession, pane = false): Promise<Raw> {
  const parent = s.parent_id ? await getSession(c.h, c.user.id, s.parent_id) : null;
  const live = s.status === "running";
  return html`<div class="ro-note">${ic("bot", "ic-sm")}<span class="grow">${c.t("sub.of", { title: parent?.title || c.t("chat.newChat") })}</span>
    ${live ? html`<button class="btn" data-variant="outline" data-size="sm" hx-post="/speca/s/${s.id}/stop" hx-swap="none">${ic("square", "ic-xs")}${c.t("sub.stop")}</button>` : ""}
    ${pane ? html`<button type="button" class="btn" data-size="sm" data-act="pane-close">${c.t("sub.backToParent")}</button>` : parent ? html`<a class="btn" data-size="sm" href="/speca/s/${parent.id}">${c.t("sub.backToParent")}</a>` : ""}</div>`;
}

export async function chatPanel(c: Ctx, s: HSession, pane = false): Promise<Raw> {
  const cx = await chatCtx(c, s);
  const all = await loadEvents(c.h, s);
  const from = turnsFrom(all, FIRST_TURNS);
  const events = all.filter((e) => e.idx >= from);
  const { html: log, maxIdx } = logHtml(cx, events);
  await markSeen(c, s, maxIdx);
  const tabs = await c.h.fns.canvas.list({ agentId: s.id }).catch(() => [] as any[]);
  const active = (tabs as any[]).find((x) => x.active) ?? null;
  return html`${chatHead(cx)}
    <div class="log" id="log" data-session="${s.id}"><div class="log-inner" id="log-inner" aria-live="off">${events.some(shownInLog) ? html`${olderMark(c.t, s.id, from)}${log}` : emptyChat(cx)}</div><div id="log-mark" data-after="${maxIdx}" hidden></div></div>
    ${s.kind === "subagent" ? await subagentNote(c, s, pane)
      : html`${schedDock(cx, [])}${queueDock(cx, [])}${composer(cx, active ? { id: String(active.id), title: active.title } : null)}`}`;
}

export function canvasWait(sid: string): Raw {
  return html`<div class="canvas-in canvas-wait" id="canvas-in" hx-get="/speca/s/${sid}/canvas" hx-trigger="load" hx-swap="outerHTML" data-live-topic="canvas:${sid}" aria-busy="true"><div class="tabbar"><div class="tabstrip"><span class="skel skel-tab"></span><span class="skel skel-tab"></span></div></div><div class="cbody"><div class="skel skel-page"></div></div></div>`;
}

export async function sessionPage(c: Ctx, s: HSession): Promise<Raw> {
  const tab = c.url.searchParams.get("tab");
  if (tab) await c.h.fns.canvas.update({ agentId: s.id, open: true, activeItemId: Number(tab) }).catch(() => undefined);
  const chat = await chatPanel(c, s);
  const canvas = tab ? await canvasHtml(c, s) : canvasWait(s.id);
  return shell({
    app: appShim, t: c.t, me: c.user, csrf: c.csrf, title: s.title || c.t("chat.newChat"), page: "session",
    sidebar: await sidebar(appShim, c.user, c.t, { session: s.id, page: null, closed: closedOf(c.req) }), chat, canvas, side: null,
  });
}

/** A page of the person's own (agents, settings…) in the shell, the sidebar on the left. */
export async function ownPage(c: Ctx, o: { title: string; page: string; body: Raw }): Promise<Raw> {
  return shell({
    app: appShim, t: c.t, me: c.user, csrf: c.csrf, title: o.title, page: o.page,
    sidebar: await sidebar(appShim, c.user, c.t, { session: null, page: o.page, closed: closedOf(c.req) }),
    chat: null, canvas: html`<div class="canvas-in" id="canvas-in"><div class="cbody" id="cbody">${o.body}</div></div>`, side: null,
  });
}
