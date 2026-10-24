// Sidebar: My day & coordinator, quick access, folders › projects › sessions, profile and plugins.
import { html, join, raw, esc, type Raw } from "../html.ts";
import { ic } from "../ui/icons.ts";
import type { App, T, UserRow, SessionRow } from "../types.ts";
import { initials } from "../types.ts";
import { rel } from "../fmt.ts";
import { listSessions, projects as loadProjects, type ProjectRow } from "../hyper.ts";
import { pending } from "../approvals.ts";

// Hyper: chats are its agents, projects its projects; the person's marks (pinned, seen) live in speca_chat.
let hctx: any = null;
/** The Hyper context the sidebar reads with (set by the routes before drawing). */
export function useHyper(h: any) { hctx = h; }

export async function sidebarData(app: App, me: UserRow) {
  const projects = await loadProjects(hctx);
  const all = await listSessions(hctx, me.id);
  const sessions = all;
  const archived = (await loadProjects(hctx, true)).map((p) => ({ id: p.id, name: p.name }));
  const agentsWorking = sessions.filter((s) => s.status === "running" || s.status === "waiting").length;
  const forkParents = new Map(all.map((s) => [s.id, s.title] as [string, string]));
  // what waits for the person across their chats (web/approvals.ts): confirmations, plans, questions
  const agentNeeds = (await pending(hctx).catch(() => [])).length;
  return { projects, sessions, badge: 0, unread: 0, coordinator: null as (SessionRow & { last_idx: number | null }) | null, people: 1, archived, forkParents, agentNeeds, agentsWorking };
}

/** A fork goes right under the chat it came from when that one is in the same list (its own forks under it). */
function threaded<S extends SessionRow>(list: S[]): Array<S & { depth: number }> {
  const ids = new Set(list.map((s) => s.id));
  const under = (s: S) => !!s.parent_id && ids.has(s.parent_id);
  const kids = new Map<string, S[]>();
  for (const s of list) if (under(s)) kids.set(s.parent_id!, [...(kids.get(s.parent_id!) ?? []), s]);
  const out: Array<S & { depth: number }> = [];
  const add = (s: S, depth: number) => { out.push({ ...s, depth }); for (const k of kids.get(s.id) ?? []) add(k, depth + 1); };
  for (const s of list) if (!under(s)) add(s, 0);
  return out;
}

function ind(s: SessionRow & { last_idx: number | null }, t: T): Raw {
  if (s.status === "error") return html`<i class="edot" aria-label="${t("status.error")}"></i>`;
  if (s.status === "waiting") return html`<i class="wdot" aria-label="${t("status.waiting")}"></i>`;
  if (s.status === "running") return html`<i class="spin" aria-label="${t("status.running")}"></i>`;
  if (s.status === "parked") return html`<span class="pz" aria-label="${t("status.parked")}">${ic("clock", "ic-xs")}</span>`;
  if ((s.last_idx ?? -1) > s.seen_idx) return html`<i class="udot" aria-label="${t("status.unread")}"></i>`;
  return html``;
}

/** Developer (admin) chats: full access to code and terminal — always marked. */
function devMark(t: T): Raw {
  return html`<span class="dev-mark" title="${t("dev.mark")}" aria-label="${t("dev.mark")}">${ic("terminal", "ic-xs")}</span>`;
}

function sessRow(s: SessionRow & { last_idx: number | null; depth?: number }, cur: string | null, t: T, me?: string, parents?: Map<string, string>): Raw {
  const own = !me || s.owner_id === me;
  // a fork: a branch mark naming the chat it came from, and a step in under it
  const fork = s.fork_idx != null && s.parent_id ? t("chat.forkedFrom", { title: parents?.get(s.parent_id) || t("chat.newChat") }) : null;
  // a subagent: under the chat that started it, with the agent's mark (Hyper's delegate)
  const sub = s.kind === "subagent" && s.parent_id ? t("sb.subOf", { title: parents?.get(s.parent_id) || t("chat.newChat") }) : null;
  return html`<a class="sess${fork || sub ? " fork" : ""}${sub ? " sub" : ""}" href="/speca/s/${s.id}" ${fork || sub ? raw(`style="--d:${Math.min(s.depth ?? 0, 3)}"`) : ""} data-sid="${s.id}" data-pinned="${s.pinned}" data-project="${s.project_id ?? ""}" aria-current="${s.id === cur}" title="${s.title}">${own ? html`<button type="button" class="row-more" data-act="row-menu" aria-label="${t("row.actions")}" data-tooltip="${t("row.actions")}" data-side="right">${ic("more", "ic-xs")}</button>` : ""}
    <span class="st-t">${fork ? html`<span class="fork-mark" data-tooltip="${fork}" data-side="right" aria-label="${fork}">${ic("fork", "ic-xs")}</span>` : ""}${sub ? html`<span class="fork-mark" data-tooltip="${sub}" data-side="right" aria-label="${sub}">${ic("bot", "ic-xs")}</span>` : ""}${s.pinned ? ic("pin", "ic-xs") : ""}${s.kind === "dev" ? devMark(t) : ""}${s.shared_write ? html`<span class="shared-mark" data-tooltip="${t("collab.pill")}" data-side="right">${ic("users", "ic-xs")}</span>` : ""}<span class="tt">${s.title || (s.kind === "dev" ? t("dev.title") : t("chat.newChat"))}</span></span><span class="ind">${ind(s, t)}</span></a>`;
}

/** The folded projects and folders, kept on this device (cookie "dh_sb_closed": project ids, folders as "f:<name>"),
 *  so a live refresh of the sidebar draws them folded at once. */
export function closedOf(req: Request): Set<string> {
  const v = (req.headers.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith("dh_sb_closed="))?.slice(13) ?? "";
  try { return new Set(decodeURIComponent(v).split(",").map((x) => x.trim()).filter(Boolean).slice(0, 500)); } catch { return new Set(); }
}

/** The product's mark and name (branding: logo, wordmark) — the sidebar's corner. */
function brand(app: App): Raw {
  const b = app.config.branding as typeof app.config.branding & { wordmark?: string | null };
  return html`<span class="brand">${b.logo ? html`<img class="brand-mark" src="${b.logo}" alt="">` : ""}${b.wordmark ? html`<img class="brand-word" src="${b.wordmark}" alt="${b.productName}">` : html`<span class="brand-name">${b.productName}</span>`}</span>`;
}

export async function sidebar(app: App, me: UserRow, t: T, cur: { session?: string | null; page?: string | null; closed?: Set<string> }): Promise<Raw> {
  const closed = cur.closed ?? new Set<string>();
  const d = await sidebarData(app, me);
  const dev = false;
  const byProject = new Map<string | null, typeof d.sessions>();
  for (const s of d.sessions) byProject.set(s.project_id, [...(byProject.get(s.project_id) ?? []), s]);
  const folders = new Map<string, ProjectRow[]>();
  const loose: ProjectRow[] = [];
  for (const p of d.projects) (p.folder ? folders.set(p.folder, [...(folders.get(p.folder) ?? []), p]) : loose.push(p));
  const LIMIT = 4;
  // where work goes on: a chat whose agent works or waits for the person is never folded away under "more"
  const live = (s: SessionRow) => s.status === "running" || s.status === "waiting" || s.status === "error";
  const working = (n: number) => n ? html`<i class="spin pact" data-tooltip="${t("sb.working", { n })}" data-side="right" aria-label="${t("sb.working", { n })}"></i>` : "";
  const projHtml = (p: ProjectRow) => {
    const list = threaded(byProject.get(p.id) ?? []);
    const attn = list.some((s) => s.status === "waiting" || s.status === "error");
    const runs = list.filter((s) => s.status === "running").length;
    const shown = list.filter((s, i) => i < LIMIT || live(s)), folded = list.filter((s, i) => i >= LIMIT && !live(s));
    const open = !closed.has(p.id);
    return html`<div class="proj" data-pid="${p.id}" data-open="${open ? "true" : "false"}">
      <div class="row" role="button" tabindex="0" data-act="proj-toggle" aria-expanded="${open ? "true" : "false"}">
        ${ic("chevRight", "ic-xs pchev")}${p.icon ? html`<span class="picon">${ic(p.icon, "ic-sm")}</span>` : ""}<span class="label">${p.name}</span>${p.members > 1 ? html`<span class="shared" title="${t("sb.shared")}">${ic("users", "ic-xs")}</span>` : ""}${working(runs)}${attn ? html`<i class="wdot pattn"></i>` : ""}
        <span class="row-acts"><button class="btn" data-variant="ghost" data-size="icon-xs" hx-post="/speca/s" hx-vals='${JSON.stringify({ project: p.id })}' aria-label="${t("sb.newChatIn")}">${ic("plus")}</button><button class="btn" data-variant="ghost" data-size="icon-xs" data-dialog="/speca/projects/${p.id}" aria-label="${t("sb.projectSettings")}">${ic("more")}</button></span>
      </div>
      <div class="collapsible"><div>
        ${join(shown.map((s) => sessRow(s, cur.session ?? null, t, me.id, d.forkParents)))}
        ${folded.length ? html`<details class="more-sess"><summary class="ses-more">${t("sb.more", { n: folded.length })}</summary>${join(folded.map((s) => sessRow(s, cur.session ?? null, t, me.id, d.forkParents)))}</details>` : ""}
        ${!list.length ? html`<button class="ses-more" hx-post="/speca/s" hx-vals='${JSON.stringify({ project: p.id })}'>${t("sb.startChat")}</button>` : ""}
        ${p.peers ? html`<a class="ses-more peers" href="/speca/projects/${p.id}/peers" data-dialog>${ic("users", "ic-xs")}${t("sb.peerSessions", { n: p.peers })}</a>` : ""}
      </div></div></div>`;
  };
  const noProject = threaded(byProject.get(null) ?? []);
  const onDay = cur.page === "day";
  const dayMark = d.badge ? html`<span class="nbadge" data-tooltip="${t("sb.waitingYou", { n: d.badge })}" data-side="right">${d.badge}</span>`
    : d.unread ? html`<span class="ind" data-tooltip="${t("sb.newResults")}" data-side="right"><i class="udot"></i></span>` : "";
  // "Agents", next to My day: the number of things the agents wait on the person for; else, while any works, that it does
  const onAgents = cur.page === "agents";
  const agentsTip = d.agentNeeds ? `${t("agents.title")} · ${t("sb.waitingYou", { n: d.agentNeeds })}` : d.agentsWorking ? `${t("agents.title")} · ${t("sb.working", { n: d.agentsWorking })}` : t("agents.title");
  const agentsMark = d.agentNeeds ? html`<span class="nbadge" data-tooltip="${t("sb.waitingYou", { n: d.agentNeeds })}" data-side="right">${d.agentNeeds}</span>`
    : d.agentsWorking ? html`<span class="ind">${working(d.agentsWorking)}</span>` : "";
  // the narrow rail (minimised sidebar): the same places as tiles with tooltips; the current project's chats under it
  const curSess = d.sessions.find((s) => s.id === cur.session) ?? null;
  const letter = (s: string) => s.trim()[0]?.toUpperCase() ?? "·";
  const railSes = (list: typeof d.sessions) => list.length ? html`<div class="rail-ses">${join(list.slice(0, 10).map((s) => html`<a class="rs ${s.id === cur.session ? "on" : ""}" href="/speca/s/${s.id}" aria-label="${s.title || t("chat.newChat")}" data-tooltip="${s.title || t("chat.newChat")}${s.fork_idx != null && s.parent_id ? ` · ${t("chat.forkedFrom", { title: d.forkParents.get(s.parent_id) || t("chat.newChat") })}` : ""}" data-side="right"><span class="rs-t">${s.kind === "dev" ? ic("terminal", "ic-xs") : s.fork_idx != null && s.parent_id ? ic("fork", "ic-xs") : s.title ? letter(s.title) : ic("msg", "ic-xs")}</span><span class="ri">${ind(s, t)}</span></a>`))}</div>` : "";
  const rail = html`<div class="rail sb-rail">
    <a class="rp ${onDay ? "on" : ""}" href="/speca/day" aria-label="${t("term.myDay")}" data-tooltip="${d.badge ? `${t("term.myDay")} · ${t("sb.waitingYou", { n: d.badge })}` : t("term.myDay")}" data-side="right"><span class="co-ic">${ic("sun", "ic-sm")}</span>${d.badge ? html`<span class="nbadge rb">${d.badge}</span>` : d.unread ? html`<i class="udot ra"></i>` : ""}</a>
    <a class="rp ${onAgents ? "on" : ""}" href="/speca/agents" aria-label="${t("agents.title")}" data-tooltip="${agentsTip}" data-side="right"><span class="co-ic">${ic("bot", "ic-sm")}</span>${d.agentNeeds ? html`<span class="nbadge rb">${d.agentNeeds}</span>` : d.agentsWorking ? html`<i class="spin ra"></i>` : ""}</a>
    <a class="rp ${cur.page === "coordinator" ? "on" : ""}" href="/speca/coordinator" aria-label="${t("term.coordinator")}" data-tooltip="${t("term.coordinator")}" data-side="right"><span class="co-ic">${ic("compass", "ic-sm")}</span></a>
    <a class="rp ${cur.page === "saved" ? "on" : ""}" href="/speca/saved" aria-label="${t("term.saved")}" data-tooltip="${t("term.saved")}" data-side="right"><span class="co-ic sv">${ic("bookmark", "ic-sm")}</span></a>
    <a class="rp ${cur.page === "coordinator-people" ? "on" : ""}" href="/speca/coordinator?view=people" aria-label="${t("sb.people")}" data-tooltip="${t("sb.people")}" data-side="right"><span class="co-ic sv">${ic("users", "ic-sm")}</span></a>
    <a class="rp ${cur.page === "connections" ? "on" : ""}" href="/speca/connections" aria-label="${t("sb.connections")}" data-tooltip="${t("sb.connections")}" data-side="right"><span class="co-ic sv">${ic("plug", "ic-sm")}</span></a>
    ${d.projects.length ? html`<hr>${join(d.projects.map((p) => {
      const list = byProject.get(p.id) ?? [];
      const on = curSess?.project_id === p.id;
      const attn = list.some((s) => s.status === "waiting" || s.status === "error");
      const runs = list.filter((s) => s.status === "running").length;
      return html`<a class="rp ${on ? "on" : ""}" href="${list[0] ? `/speca/s/${list[0].id}` : "#"}" ${list[0] ? "" : html`hx-post="/speca/s" hx-vals='${JSON.stringify({ project: p.id })}'`} aria-label="${p.name}" data-tooltip="${runs ? `${p.name} · ${t("sb.working", { n: runs })}` : p.name}" data-side="right"><span class="pav">${p.icon ? ic(p.icon) : letter(p.name)}</span>${attn ? html`<i class="wdot ra"></i>` : runs ? html`<i class="spin ra"></i>` : ""}</a>${on ? railSes(list) : ""}`;
    }))}` : ""}
    ${noProject.length ? html`<hr>${railSes(noProject)}` : ""}
    <hr><button class="rp" hx-post="/speca/s" aria-label="${t("sb.newChat")}" data-tooltip="${t("sb.newChat")} · Ctrl N" data-side="right"><span class="co-ic sv">${ic("plus", "ic-sm")}</span></button>
  </div>`;
  return html`<div class="sb-inner" id="sb-inner" hx-get="/speca/f/sidebar?s=${cur.session ?? ""}&p=${cur.page ?? ""}" hx-trigger="dh-live, every 60s" hx-swap="outerHTML" hx-select="#sb-inner" data-live-topic="user:${me.id} day:${me.id} org">
    <div class="sb-head">
      <div class="dropdown-menu sb-brandm" id="sbmenu"><button type="button" id="sbmenu-trigger" class="sb-brand" aria-haspopup="menu" aria-controls="sbmenu-menu" aria-expanded="false" aria-label="${t("sb.menu")}">${brand(app)}${ic("chevDown", "ic-xs sb-brand-chev")}</button>
        <div id="sbmenu-popover" data-popover aria-hidden="true" data-side="bottom" data-align="start"><div role="menu" id="sbmenu-menu" aria-labelledby="sbmenu-trigger">
          <div role="menuitem" data-act="palette">${ic("search")}${t("pal.title")}<span data-shortcut>Ctrl K</span></div>
          <div role="menuitem" hx-post="/speca/s">${ic("msg")}${t("sb.newChat")}<span data-shortcut>Ctrl N</span></div>
          <div role="menuitem" data-dialog="/speca/projects/new">${ic("folderPlus")}${t("sb.newProject")}</div>
          <hr role="separator">
          <a role="menuitem" href="/speca/day">${ic("sun")}${t("term.myDay")}</a>
          <a role="menuitem" href="/speca/coordinator">${ic("compass")}${t("term.coordinator")}</a>
          <a role="menuitem" href="/speca/artifacts">${ic("layers")}${t("art.title")}</a>
          <a role="menuitem" href="/speca/saved">${ic("bookmark")}${t("term.saved")}</a>
          <a role="menuitem" href="/speca/coordinator?view=people">${ic("users")}${t("sb.people")}</a>
          <a role="menuitem" href="/speca/connections">${ic("plug")}${t("sb.connections")}</a>
          <hr role="separator">
          <a role="menuitem" href="/speca/plugins" data-dialog>${ic("puzzle")}${t("sb.plugins")}</a>
          <a role="menuitem" href="/speca/settings/routines">${ic("clock")}${t("set.routines")}</a>
          <a role="menuitem" href="/speca/settings">${ic("settings")}${t("sb.settings")}</a>
          <a role="menuitem" href="/speca/admin">${ic("building")}${t("sb.admin")}</a>
        </div></div></div>
      <span class="grow sb-head-gap"></span>
      <button class="btn sb-find" data-variant="ghost" data-size="icon-sm" data-act="palette" aria-label="${t("pal.title")}" data-tooltip="${t("pal.title")} · Ctrl K" data-side="bottom" data-kbd-mac="⌘K">${ic("search")}</button>
      <div class="dropdown-menu" id="sbplus"><button type="button" id="sbplus-trigger" class="btn" data-variant="ghost" data-size="icon-sm" aria-haspopup="menu" aria-controls="sbplus-menu" aria-expanded="false" aria-label="${t("sb.create")}">${ic("plus")}</button>
        <div id="sbplus-popover" data-popover aria-hidden="true" data-side="bottom" data-align="end"><div role="menu" id="sbplus-menu" aria-labelledby="sbplus-trigger">
          <div role="menuitem" hx-post="/speca/s">${ic("msg")}${t("sb.newChat")}<span data-shortcut>Ctrl N</span></div>
          <div role="menuitem" data-dialog="/speca/projects/new">${ic("folderPlus")}${t("sb.newProject")}</div>
          ${dev ? html`<hr role="separator"><div role="menuitem" hx-post="/speca/s/dev">${ic("terminal")}<span>${t("dev.new")}<br><small class="muted">${t("dev.newHint")}</small></span></div>` : ""}
        </div></div></div>
      <button class="btn sb-hide" data-variant="ghost" data-size="icon-sm" data-act="sb-toggle" aria-label="${t("sb.collapse")}" data-tooltip="${t("sb.collapse")} · Ctrl B" data-side="bottom"><span class="sbh-c">${ic("panelLeft")}</span></button>
    </div>
    <div class="sb-scroll sb-rail-wrap">${rail}</div>
    <div class="sb-scroll sb-results" id="sbResults" hidden></div>
    <div class="sb-scroll" id="sbList">
      <div class="nav-top">
        <a class="sess coord" href="/speca/day" aria-current="${onDay}"><span class="co-ic">${ic("sun", "ic-sm")}</span><span class="st-t"><span class="tt">${t("term.myDay")}</span></span>${dayMark}</a>
        <a class="sess coord" href="/speca/agents" aria-current="${onAgents}"><span class="co-ic">${ic("bot", "ic-sm")}</span><span class="st-t"><span class="tt">${t("agents.title")}</span></span>${agentsMark}</a>
        <a class="sess coord" href="/speca/coordinator" aria-current="${cur.page === "coordinator"}" data-tooltip="${t("sb.coordinatorHint")}" data-side="right"><span class="co-ic">${ic("compass", "ic-sm")}</span><span class="st-t"><span class="tt">${t("term.coordinator")}</span></span><span class="ind">${d.coordinator ? ind(d.coordinator, t) : ""}</span></a>
        <div class="nav-sub" data-open="true"><div class="row grp-h nav-more" role="button" tabindex="0" data-act="nav-more" aria-expanded="true"><span class="label">${t("sb.quick")}</span>${ic("chevDown", "ic-xs chev")}</div>
          <div class="collapsible"><div>
            <a class="sess coord saved-row" href="/speca/saved" aria-current="${cur.page === "saved"}"><span class="co-ic sv">${ic("bookmark", "ic-sm")}</span><span class="st-t"><span class="tt">${t("term.saved")}</span></span></a>
            <a class="sess coord saved-row" href="/speca/coordinator?view=people" aria-current="${cur.page === "coordinator-people"}"><span class="co-ic sv">${ic("users", "ic-sm")}</span><span class="st-t"><span class="tt">${t("sb.people")}</span></span><span class="svn">${d.people}</span></a>
            <a class="sess coord saved-row" href="/speca/connections" aria-current="${cur.page === "connections"}"><span class="co-ic sv">${ic("plug", "ic-sm")}</span><span class="st-t"><span class="tt">${t("sb.connections")}</span></span></a>
          </div></div></div>
      </div>
      ${d.projects.length ? html`<div class="sb-sec"><div class="grp-h static proj-h"><span class="label">${t("sb.projects")}</span><button type="button" class="btn" data-variant="ghost" data-size="icon-xs" data-act="projects-fold" data-fold="${t("pal.collapseProjects")}" data-unfold="${t("pal.expandProjects")}" aria-label="${t("pal.collapseProjects")}" data-tooltip="${t("pal.collapseProjects")}" data-side="right"><span class="pf-fold">${ic("chevronsDownUp", "ic-xs")}</span><span class="pf-unfold">${ic("chevronsUpDown", "ic-xs")}</span></button></div>` : ""}
      ${join([...folders.entries()].map(([f, ps]) => { const fo = !closed.has(`f:${f}`); return html`<section class="folder grp" data-fid="f:${f}" data-open="${fo ? "true" : "false"}"><div class="row folder-row" role="button" tabindex="0" data-act="folder-toggle" aria-expanded="${fo ? "true" : "false"}" title="${t("sb.folder")}">${ic("chevRight", "ic-xs pchev")}${ic("folder", "ic-sm fico")}<span class="label">${f}</span></div><div class="collapsible"><div>${join(ps.map(projHtml))}</div></div></section>`; }))}
      ${loose.length ? html`<section class="grp">${join(loose.map(projHtml))}</section>` : ""}${d.projects.length ? html`</div>` : ""}
      ${noProject.length ? html`<section class="grp sb-sec"><div class="grp-h static"><span class="label">${t("sb.chats")}</span></div><div class="loose-sess">${join(noProject.slice(0, 12).map((s) => sessRow(s, cur.session ?? null, t, me.id, d.forkParents)))}${noProject.length > 12 ? html`<details class="more-sess"><summary class="ses-more">${t("sb.more", { n: noProject.length - 12 })}</summary>${join(noProject.slice(12).map((s) => sessRow(s, cur.session ?? null, t, me.id, d.forkParents)))}</details>` : ""}</div></section>` : ""}
      ${!d.projects.length && !noProject.length ? html`<div class="hint-empty">${t("sb.emptyHint")}</div>` : ""}
      ${d.archived.length ? html`<details class="sb-archived"><summary class="grp-h">${ic("archive", "ic-xs")}<span class="label">${t("sb.archivedProjects")}</span><span class="svn">${d.archived.length}</span></summary>${join(d.archived.map((p) => html`<div class="sess arch-proj"><span class="st-t"><span class="tt">${p.name}</span></span><button class="btn" data-variant="ghost" data-size="sm" hx-post="/speca/projects/${p.id}/restore">${t("proj.restore")}</button></div>`))}</details>` : ""}
    </div>
    <div class="rowmenu" id="rowmenu" role="menu" hidden>
      <button type="button" role="menuitem" data-rm="rename">${ic("pencil", "ic-sm")}${t("chat.rename")}</button>
      <button type="button" role="menuitem" data-rm="pin">${ic("pin", "ic-sm")}<span class="rm-pin" data-on="${t("chat.unpin")}" data-off="${t("chat.pin")}">${t("chat.pin")}</span></button>
      <div class="rm-sub"><div class="rm-h">${ic("folder", "ic-sm")}${t("row.moveTo")}</div>
        ${join(d.projects.map((p) => html`<button type="button" role="menuitem" data-rm="move" data-project="${p.id}"><span class="pav">${p.name.trim()[0]?.toUpperCase()}</span>${p.name}</button>`))}
        <button type="button" role="menuitem" data-rm="move" data-project="">${ic("x", "ic-sm")}${t("row.noProject")}</button></div>
      <hr>
      <button type="button" role="menuitem" class="rm-del" data-rm="delete">${ic("trash", "ic-sm")}${t("row.delete")}</button>
    </div>
    <div class="sb-foot">
      <div class="dropdown-menu grow" id="who"><button type="button" id="who-trigger" class="who" aria-haspopup="menu" aria-controls="who-menu" aria-expanded="false"><span class="me">${initials(me.name)}</span><span class="me-name">${me.name}<small>${me.title ?? me.email}</small></span>${ic("chevDown", "ic-xs")}</button>
        <div id="who-popover" data-popover aria-hidden="true" data-side="top" data-align="start"><div role="menu" id="who-menu" aria-labelledby="who-trigger">
          <a role="menuitem" href="/speca/settings">${ic("settings")}${t("sb.settings")}</a>
          <a role="menuitem" href="/speca/settings/access">${ic("shield")}${t("sb.myRules")}</a>
          <a role="menuitem" href="/speca/settings/models">${ic("cpu")}${t("sb.models")}</a>
          <a role="menuitem" href="/speca/admin">${ic("building")}${t("sb.admin")}</a>
          <hr role="separator">
          <form method="post" action="/auth/logout" class="mi-form"><button role="menuitem" class="mi">${ic("logout")}${t("sb.logout")}</button></form>
        </div></div></div>
      <a class="btn sb-plug" data-variant="ghost" data-size="icon-sm" href="/speca/plugins" data-dialog aria-label="${t("sb.plugins")}" data-tooltip="${t("sb.plugins")}" data-side="top">${ic("puzzle")}</a>
      <button class="btn" data-variant="ghost" data-size="icon-sm" id="themeBtn" data-act="theme" aria-label="${t("sb.theme")}" data-tooltip="${t("sb.theme")}" data-side="top">${ic("moon")}</button>
    </div>
  </div>`;
}

type Hit = { id: string; title: string; kind: string; project: string | null; updatedAt: Date; count: number; archived: boolean; snippets: Array<{ idx: number; who: "you" | "agent" | "canvas"; text: string }>; why?: string; summary?: string };
const queryTerms = (q: string) => q.toLowerCase().split(/\s+/).map((x) => x.trim()).filter((x) => x.length > 1).slice(0, 8);
const meaningAvailable = (_app: App, _me: UserRow) => false;
async function searchByMeaning(_app: App, _me: UserRow, _q: string, _o: { exclude: string[] }): Promise<Hit[]> { return []; }

/** Chats whose title or messages hold every word of the query (Hyper's agents and their user/assistant events). */
async function searchChats(_app: App, _me: string, query: string): Promise<Hit[]> {
  const terms = queryTerms(query);
  if (!terms.length) return [];
  const like = terms.map((t) => `%${t.replace(/[%_\\]/g, "")}%`);
  const rows = (await hctx.fns.procs.db.select({
    sql: `SELECT a.id, a.title, a.updated_at, a.archived_at, p.title AS project,
            (SELECT json_agg(x) FROM (SELECT e.idx, e.type, e.payload::json->>'text' AS text FROM events e
               WHERE e.agent_id = a.id AND e.type IN ('user','assistant') AND ${like.map(() => "lower(e.payload::json->>'text') LIKE ?").join(" AND ")}
               ORDER BY e.idx DESC LIMIT 3) x) AS hits
          FROM agents a LEFT JOIN projects p ON p.id = a.project_id
          WHERE ${like.map(() => "lower(a.title) LIKE ?").join(" AND ")}
             OR EXISTS (SELECT 1 FROM events e WHERE e.agent_id = a.id AND e.type IN ('user','assistant') AND ${like.map(() => "lower(e.payload::json->>'text') LIKE ?").join(" AND ")})
          ORDER BY a.updated_at DESC LIMIT 30`,
    params: [...like, ...like, ...like],
  })) as any[];
  return rows.map((r) => {
    const hits = (typeof r.hits === "string" ? JSON.parse(r.hits) : r.hits) ?? [];
    return {
      id: r.id, title: r.title, kind: "chat", project: r.project ?? null, updatedAt: new Date(Number(r.updated_at)), count: hits.length, archived: !!r.archived_at,
      snippets: hits.slice(0, 1).map((h: any) => {
        const text = String(h.text ?? ""), at = Math.max(0, text.toLowerCase().indexOf(terms[0]!) - 60);
        return { idx: Number(h.idx) * 10, who: h.type === "user" ? "you" as const : "agent" as const, text: `${at ? "…" : ""}${text.slice(at, at + 180)}` };
      }),
    };
  });
}

/** Matched terms wrapped in <mark>; everything else escaped. */
function marked(text: string, terms: string[]): Raw {
  if (!terms.length) return html`${text}`;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return raw(text.split(re).map((part, i) => (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part))).join(""));
}

/** Search results that replace the session list while the sidebar search has a query. */
export async function searchResults(app: App, me: UserRow, t: T, query: string): Promise<Raw> {
  const terms = queryTerms(query);
  const hits = await searchChats(app, me.id, query);
  // search by meaning arrives a moment later, below the word matches
  const meaning = meaningAvailable(app, me) && query.trim().length >= 3
    ? html`<div class="sr-meaning" hx-get="/speca/f/search/meaning?q=${encodeURIComponent(query)}&skip=${hits.map((h) => h.id).join(",")}" hx-trigger="load delay:400ms" hx-swap="outerHTML" hx-select=".sr-meaning"><div class="grp-h static"><span class="label">${t("search.meaning")}</span></div><div class="sr-wait"><i class="spin"></i><span class="shimmer">${t("search.meaningWait")}</span></div></div>`
    : "";
  if (!hits.length) return html`<div class="sr-list">${meaning ? "" : html`<div class="sr-empty">${t("search.none")}</div>`}${meaning}</div>`;
  return html`<div class="sr-list"><div class="grp-h static"><span class="label">${t("search.found", { n: hits.length })}</span></div>${join(hits.map((h) => {
    const sn = h.snippets[0];
    const href = `/speca/s/${h.id}${sn && sn.idx >= 0 ? `?at=${sn.idx}` : ""}`;
    const meta = html`<span class="sr-meta">${h.project ? html`${h.project} · ` : ""}${rel(h.updatedAt, t.locale)}${h.count > 1 ? html` · ${t("search.matches", { n: h.count })}` : ""}${h.archived ? html` · ${t("search.archived")}` : ""}</span>`;
    const body = html`<span class="sr-t">${h.kind === "dev" ? devMark(t) : h.kind === "coordinator" ? ic("compass", "ic-xs") : ""}<span class="tt">${marked(h.title || t("chat.newChat"), terms)}</span></span>
      ${sn ? html`<span class="sr-snip">${sn.who === "agent" ? html`<b>${t("search.agent")}:</b> ` : sn.who === "canvas" ? html`<b>${t("search.canvas")}:</b> ` : ""}${marked(sn.text, terms)}</span>` : ""}${meta}`;
    return h.archived
      ? html`<button type="button" class="sr-item" hx-post="/speca/s/${h.id}/unarchive" hx-vals='${JSON.stringify({ at: sn?.idx ?? "" })}' title="${t("search.restore")}">${body}</button>`
      : html`<a class="sr-item" href="${href}">${body}</a>`;
  }))}${meaning}</div>`;
}

/** The "by meaning" part of the search: chats a model picked for what the query means, each with a reason. */
export async function meaningResults(app: App, me: UserRow, t: T, query: string, skip: string[]): Promise<Raw> {
  let hits: Awaited<ReturnType<typeof searchByMeaning>> = [];
  try { hits = await searchByMeaning(app, me, query, { exclude: skip }); }
  catch (e) { return html`<div class="sr-meaning"><div class="grp-h static"><span class="label">${t("search.meaning")}</span></div><div class="sr-empty">${t("search.meaningFailed")}</div></div>`; }
  if (!hits.length) return html`<div class="sr-meaning"><div class="grp-h static"><span class="label">${t("search.meaning")}</span></div><div class="sr-empty">${skip.length ? t("search.meaningNoMore") : t("search.none")}</div></div>`;
  return html`<div class="sr-meaning"><div class="grp-h static"><span class="label">${t("search.meaning")}</span></div>${join(hits.map((h) => {
    const body = html`<span class="sr-t">${h.kind === "dev" ? devMark(t) : h.kind === "coordinator" ? ic("compass", "ic-xs") : ic("sparkle", "ic-xs")}<span class="tt">${h.title || t("chat.newChat")}</span></span>
      <span class="sr-snip sr-why">${h.why}</span>
      <span class="sr-meta">${h.project ? html`${h.project} · ` : ""}${rel(h.updatedAt, t.locale)}${h.archived ? html` · ${t("search.archived")}` : ""}</span>`;
    return h.archived
      ? html`<button type="button" class="sr-item" hx-post="/speca/s/${h.id}/unarchive" title="${t("search.restore")}">${body}</button>`
      : html`<a class="sr-item" href="/speca/s/${h.id}" title="${h.summary}">${body}</a>`;
  }))}</div>`;
}
