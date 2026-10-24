// The adapter: Hyper's tables (agents, events, projects, canvas_items, users) read as the shapes Speca's views expect
// (SessionRow, EventRow, UserRow, ModelOption). Hyper keeps no turns, statuses or "seen" marks — they are derived
// here (turns from the events, status from run_state), the rest lives in speca_chat / speca_user.
import { userInfo } from "node:os";
import type { App, EventRow, ModelOption, PlanItem, SessionRow, UserRow, UserSettings } from "./types.ts";
import { prettyModel } from "./types.ts";

type Ctx = any;

const sel = async <R = any>(ctx: Ctx, sql: string, params: unknown[] = []): Promise<R[]> =>
  (await ctx.fns.procs.db.select({ sql, params })) as R[];
const run = async (ctx: Ctx, sql: string, params: unknown[] = []) => ctx.fns.procs.db.run({ sql, params });

export const appShim: App = {
  registry: { tools: new Map(), plugins: new Map(), fences: new Map(), canvases: new Map() },
  config: {
    branding: { productName: "Speca", logo: "/speca/assets/brand/speca-mark.png", wordmark: "/speca/assets/brand/speca-word.png", theme: { light: {}, dark: {} } },
    effects: { fullAccess: true },
    org: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" },
  },
};

// ── the person ─────────────────────────────────────────────────────────
export async function me(ctx: Ctx, session: any): Promise<UserRow> {
  const u = session?.user ?? null;
  const id: string = u?.id ?? "local";
  const name: string = u?.name || u?.email || prettyName(userInfo().username);
  const row = (await sel<{ settings: any }>(ctx, "SELECT settings FROM speca_user WHERE user_id = ?", [id]).catch(() => []))[0];
  const settings: UserSettings = typeof row?.settings === "string" ? JSON.parse(row.settings) : row?.settings ?? {};
  return {
    id, email: u?.email ?? `${userInfo().username}@local`, name, title: null, avatar_url: u?.picture ?? null,
    locale: (settings.locale as any) ?? "ru", tz: (settings.tz as any) ?? appShim.config.org.timezone, status: "active",
    settings, onboarded_at: new Date(), created_at: new Date(),
  };
}
const prettyName = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export async function saveSettings(ctx: Ctx, userId: string, patch: Partial<UserSettings>): Promise<void> {
  await run(ctx, `INSERT INTO speca_user (user_id, settings) VALUES (?, ?::jsonb)
    ON CONFLICT (user_id) DO UPDATE SET settings = speca_user.settings || EXCLUDED.settings`, [userId, JSON.stringify(patch)]);
}

// ── chats (Hyper agents) ───────────────────────────────────────────────
type AgentRow = {
  id: string; title: string; model: string; parent_id: string | null; fork_offset: number | null; project_id: string | null;
  run_state: string; next_run_at: string | null; last_error: string | null; created_at: string; updated_at: string; archived_at: string | null;
  workspace_dir: string; reasoning_effort: string; scratchpad?: string; created_by: string | null; last_idx: number | null; last_type: string | null;
  seen_idx: number | null; pinned: boolean | null; autonomy: string | null; mode: string | null;
};

const AGENT_COLS = `a.id, a.title, a.model, a.parent_id, a.fork_offset, a.project_id, a.run_state, a.next_run_at, a.last_error,
  a.created_at, a.updated_at, a.archived_at, a.workspace_dir, a.reasoning_effort, a.created_by,
  (SELECT max(idx) FROM events e WHERE e.agent_id = a.id) AS last_idx,
  (SELECT type FROM events e WHERE e.agent_id = a.id AND e.type NOT IN ('tool_busy','team_update','model_changed') ORDER BY idx DESC LIMIT 1) AS last_type,
  c.seen_idx, c.pinned, c.autonomy, c.mode`;

function toSession(r: AgentRow, owner: string): SessionRow & { last_idx: number | null } {
  const sp = r.scratchpad ? safeJson(r.scratchpad) : {};
  const next = r.next_run_at ? Number(r.next_run_at) : null;
  const status: SessionRow["status"] = r.run_state === "running" ? "running"
    : next && next > Date.now() ? "parked"
    : r.last_type === "error" ? "error" : "idle";
  const plan: PlanItem[] | null = Array.isArray(sp?.plan?.tasks) && sp.plan.tasks.length
    ? sp.plan.tasks.map((t: any) => ({ content: String(t.title ?? t.id), status: t.status === "done" ? "completed" : t.status === "active" ? "in_progress" : "pending" }))
    : null;
  const effort = (["low", "medium", "high", "xhigh"] as const).find((e) => e === r.reasoning_effort) ?? null;
  return {
    id: r.id, owner_id: owner, project_id: r.project_id, title: r.title || "",
    kind: r.parent_id && r.fork_offset === 0 && sp?.delegation ? "subagent" : r.parent_id ? "chat" : "chat",
    parent_id: r.parent_id, fork_idx: r.parent_id && !sp?.delegation ? (r.fork_offset ?? 0) : null,
    status, autonomy: (r.autonomy as any) ?? "full", mode: (r.mode as any) ?? "work",
    model: r.model, toolset: null, label: null, policy_override: null, plan,
    engine_state: {}, error: r.last_error, run_token: null, run_heartbeat_at: null, run_attempts: 0,
    next_run_at: next ? new Date(next) : null, parked_until: next ? new Date(next) : null,
    pinned: !!r.pinned, seen_idx: r.seen_idx ?? -1, archived_at: r.archived_at ? new Date(Number(r.archived_at)) : null,
    created_at: new Date(Number(r.created_at)), updated_at: new Date(Number(r.updated_at)),
    shared_write: false, activity: null, activity_at: null, effort, workspace_dir: r.workspace_dir || null,
    last_idx: r.last_idx,
    // Hyper extras the views of this port read
    ...({ delegation: sp?.delegation ?? null, planRaw: sp?.plan ?? null } as any),
  };
}
const safeJson = (s: string) => { try { return JSON.parse(s); } catch { return {}; } };

export type HSession = SessionRow & { last_idx: number | null; delegation?: any; planRaw?: any };

export async function listSessions(ctx: Ctx, userId: string, o: { archived?: boolean; limit?: number } = {}): Promise<HSession[]> {
  const rows = await sel<AgentRow>(ctx, `SELECT ${AGENT_COLS}, a.scratchpad FROM agents a
    LEFT JOIN speca_chat c ON c.agent_id = a.id AND c.user_id = ?
    WHERE a.archived_at IS ${o.archived ? "NOT " : ""}NULL AND coalesce(a.visibility,'nav') <> 'hidden'
    ORDER BY coalesce(c.pinned,false) DESC, a.updated_at DESC LIMIT ${o.limit ?? 300}`, [userId]);
  return rows.map((r) => toSession(r, userId));
}

export async function getSession(ctx: Ctx, userId: string, id: string): Promise<HSession | null> {
  const r = (await sel<AgentRow>(ctx, `SELECT ${AGENT_COLS}, a.scratchpad FROM agents a
    LEFT JOIN speca_chat c ON c.agent_id = a.id AND c.user_id = ? WHERE a.id = ?`, [userId, id]))[0];
  return r ? toSession(r, userId) : null;
}

export async function children(ctx: Ctx, userId: string, id: string): Promise<HSession[]> {
  const rows = await sel<AgentRow>(ctx, `SELECT ${AGENT_COLS}, a.scratchpad FROM agents a
    LEFT JOIN speca_chat c ON c.agent_id = a.id AND c.user_id = ? WHERE a.parent_id = ? ORDER BY a.created_at`, [userId, id]);
  return rows.map((r) => toSession(r, userId));
}

export async function setChat(ctx: Ctx, userId: string, id: string, patch: { seen_idx?: number; pinned?: boolean; autonomy?: string; mode?: string }): Promise<void> {
  const cols = Object.keys(patch) as Array<keyof typeof patch>;
  if (!cols.length) return;
  await run(ctx, `INSERT INTO speca_chat (agent_id, user_id, ${cols.join(", ")}) VALUES (?, ?, ${cols.map(() => "?").join(", ")})
    ON CONFLICT (agent_id, user_id) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(", ")}`,
    [id, userId, ...cols.map((c) => patch[c])]);
}

/** The text the agent writes now (streamed), when it works. */
export function liveDraft(ctx: Ctx, id: string): string | null {
  const a = ctx.state?.agent?.[id];
  const t = a?.scratchpad?.mobileStream?.text;
  return a && typeof t === "string" && t.trim() ? t : null;
}

// ── events → the log Speca's views fold ─────────────────────────────────
type HEvent = { idx: number; type: string; payload: string; ts: string; actor: string | null };

/** A chat's events as the rows Speca's log folds into turns. One Hyper event is one row with its own idx: the agent
 *  loop marks every run with turn_start / turn_end (agent.run), a finished tool call is one tool_result row with its
 *  arguments, a tool still running and the text being streamed come last, at the last idx, while the agent works.
 *  History written before turns were marked (no turn_start) is grouped by the person's messages. */
export async function loadEvents(ctx: Ctx, s: HSession, opts: { after?: number; before?: number } = {}): Promise<EventRow[]> {
  const rows = await sel<HEvent>(ctx, "SELECT idx, type, payload, ts, actor FROM events WHERE agent_id = ? ORDER BY idx", [s.id]);
  const busy = s.status === "running" || s.status === "parked";
  const out = toLog(s, rows, busy ? live(ctx, s.id) : null, await delegated(ctx, s.id));
  return out.filter((e) => (opts.after == null || e.idx > opts.after) && (opts.before == null || e.idx < opts.before));
}

/** What the agent does right now: the text it streams and the tools it runs (memory only). */
function live(ctx: Ctx, id: string): { draft: string | null; tools: Array<{ id: string; name: string; subject: string | null; startedAt: number; tail: string }> } {
  const draft = ctx.fns.agent.liveText?.({ id })?.text ?? liveDraft(ctx, id);
  const runs: any = ctx.state?.toolRuns;
  const tools = runs ? [...(runs.values?.() ?? Object.values(runs))].filter((r: any) => r?.agentId === id)
    .map((r: any) => ({ id: String(r.id), name: String(r.name ?? "tool"), subject: r.subject ?? null, startedAt: Number(r.startedAt ?? Date.now()), tail: String(r.tail ?? "") })) : [];
  return { draft: draft && draft.trim() ? draft : null, tools };
}

/** The chat's subagents (agent.delegate's children): when each was started and on which model — the log puts a
 *  live card where the agent started it, as Speca does. */
type Delegated = { id: string; name: string; model: string; at: number };
async function delegated(ctx: Ctx, id: string): Promise<Delegated[]> {
  const rows = await sel<{ id: string; title: string | null; model: string | null; scratchpad: any; created_at: any }>(ctx,
    "SELECT id, title, model, scratchpad, created_at FROM agents WHERE parent_id = ? ORDER BY created_at", [id]);
  return rows.map((r) => ({ r, d: safeJson(typeof r.scratchpad === "string" ? r.scratchpad : JSON.stringify(r.scratchpad ?? {})).delegation }))
    .filter((x) => x.d).map(({ r, d }) => ({ id: String(r.id), name: String(r.title || d.title || r.id), model: String(r.model ?? ""), at: Number(d.createdAt ?? r.created_at) }));
}

export function toLog(s: HSession, rows: HEvent[], now: ReturnType<typeof live> | null, subs: Delegated[] = []): EventRow[] {
  const out: EventRow[] = [];
  const subIds = new Set(subs.map((x) => x.id));
  const pending = [...subs];
  const ev = (idx: number, type: string, data: Record<string, any>, ts: number) => out.push({ session_id: s.id, idx, type, family: null, data, ts: new Date(ts) });
  let open = false, marked = false, started = 0;
  let tokens = { in: 0, cached: 0, out: 0 };
  const begin = (idx: number, ts: number) => { ev(idx, "turn_start", { turnId: `t${idx}` }, ts); open = true; started = ts; tokens = { in: 0, cached: 0, out: 0 }; };
  const end = (idx: number, ts: number, reason: string, error: string | null = null, ms?: number) => {
    ev(idx, "turn_end", { reason, error, ms: ms ?? Math.max(0, ts - started), tokens: tokens.in + tokens.out ? tokens : null }, ts); open = false;
  };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const p = safeJson(r.payload);
    const ts = Number(r.ts);
    // a subagent started before this row: its card goes here (inside the turn that started it)
    while (pending.length && pending[0]!.at <= ts) {
      const d = pending.shift()!;
      ev(r.idx, "subagent_started", { subId: d.id, name: d.name, modelLabel: prettyModel(d.model) }, d.at);
    }
    switch (r.type) {
      case "turn_start": {
        if (open) end(r.idx, ts, "completed");
        marked = true; begin(r.idx, ts); break;
      }
      case "turn_end": {
        if (!open) break;
        const reason = p.status === "cancelled" ? "cancelled" : p.status === "failed" ? "failed" : p.status === "waiting" ? "waiting" : "completed";
        end(r.idx, ts, reason, p.error ?? null, Number(p.ms ?? 0) || undefined);
        break;
      }
      case "user": {
        // before turns were marked, a person's message after the agent rested opened one
        if (!open && !marked) begin(r.idx, ts);
        const { text, context } = splitContext(String(p.text ?? ""));
        ev(r.idx, "user_message", { text, context, author: r.actor ?? undefined, attachments: (p.attachments ?? []).map((a: any) => ({ id: a.id, name: a.fileName ?? a.name, mime: a.mimeType ?? a.mime, size: a.size })) }, ts);
        break;
      }
      case "assistant": {
        if (!open && !marked) begin(r.idx, ts);
        const u = p.usage ?? {};
        tokens.in += Number(u.prompt_tokens ?? u.input ?? u.inputTokens ?? 0); tokens.cached += Number(u.cache_read_tokens ?? u.cacheRead ?? u.cachedInputTokens ?? 0); tokens.out += Number(u.completion_tokens ?? u.output ?? u.outputTokens ?? 0);
        ev(r.idx, "assistant_message", { text: p.text ?? "", toolCalls: [] }, ts);
        // legacy: the answer closes the turn when the person speaks next
        if (!marked) {
          const next = rows.slice(i + 1).find((x) => ["user", "assistant", "error", "tool_call", "turn_start"].includes(x.type) && !(x.type === "tool_call" && safeJson(x.payload).name === "respondHtml"));
          if (next?.type === "user") end(r.idx, ts, "completed");
        }
        break;
      }
      case "tool_call": {
        if (p.name === "respondHtml") break; // the assistant row after it says the same
        if (!open && !marked) begin(r.idx, ts);
        ev(r.idx, "tool_result", { callId: `c${r.idx}`, name: p.name, args: p.args ?? {}, status: "done", text: typeof p.result === "string" ? p.result : JSON.stringify(p.result ?? ""), isError: !!p.isError, meta: p.meta ?? null }, ts);
        break;
      }
      case "error": {
        const msg = String(p.error ?? "error");
        if (marked) { ev(r.idx, "notice", { text: msg, kind: "error" }, ts); break; } // turn_end carries the outcome
        if (!open) begin(r.idx, ts);
        end(r.idx, ts, /stopp|abort|cancel/i.test(msg) ? "cancelled" : "failed", msg);
        break;
      }
      case "team_update": {
        // a subagent with a card: its steps show on the card, its report comes once as "the subagent's report"
        if (p.memberId && subIds.has(String(p.memberId))) {
          if (p.event === "plan.completed") ev(r.idx, "subagent_result", { name: subs.find((x) => x.id === String(p.memberId))?.name ?? "", text: String(p.summary ?? "") }, ts);
          else if (p.event === "blocked") ev(r.idx, "notice", { text: String(p.summary ?? p.event), sub: p.memberId }, ts);
          break;
        }
        if (p.event && p.memberId) ev(r.idx, "notice", { text: `${p.taskTitle ? `${p.taskTitle}: ` : ""}${p.summary ?? p.event}`, sub: p.memberId }, ts);
        break;
      }
      case "turn_changes": {
        // what a turn (or the person, by hand) changed in the chat's folder: the "N files changed" card
        ev(r.idx, "turn_changes", p, ts);
        break;
      }
      case "model_changed": {
        ev(r.idx, "system_note", { text: `${prettyModel(String(p.from ?? ""))} → ${prettyModel(String(p.to ?? ""))}` }, ts);
        break;
      }
      default: break;
    }
  }
  const last = rows[rows.length - 1];
  if (!last) return out;
  if (now && open) {
    // the agent at work: the tools it runs, then the text it writes
    for (const t of now.tools) ev(last.idx, "tool_result", { callId: `run-${t.id}`, name: t.name, args: t.subject ? { subject: t.subject } : {}, status: "running", text: t.tail, startedAt: t.startedAt }, t.startedAt);
    if (now.draft) ev(last.idx, "assistant_draft", { text: now.draft }, Date.now());
  } else if (open && !marked) end(last.idx, Number(last.ts), "completed");
  return out;
}

// ── models ─────────────────────────────────────────────────────────────
export async function models(ctx: Ctx): Promise<ModelOption[]> {
  let byProvider: Record<string, string[]> = {};
  try { byProvider = await ctx.fns.llm.listModels({}); } catch { /* no providers */ }
  const out: ModelOption[] = [];
  for (const [provider, list] of Object.entries(byProvider ?? {})) {
    for (const m of list ?? []) {
      const engine = /codex/.test(provider) ? "codex" : "native";
      const type = /anthropic|claude/.test(provider) ? "anthropic" : /openai|codex/.test(provider) ? "openai" : provider;
      const src = providerLabel(provider);
      out.push({ ref: `${provider}:${m}`, sourceId: provider, type, engine, alias: m, model: m, label: `${src} · ${prettyModel(m)}`, personal: /personal|oauth/.test(provider) });
    }
  }
  return out;
}
function providerLabel(p: string): string {
  const [base, acc] = p.split("/");
  const name: Record<string, string> = { "anthropic-oauth": "Claude", anthropic: "Anthropic", openai: "OpenAI", "openai-codex": "ChatGPT", codex: "ChatGPT", openrouter: "OpenRouter", mock: "Mock" };
  return `${name[base!] ?? base}${acc && acc !== "default" && acc !== "personal" ? ` (${acc})` : ""}`;
}

// ── projects ───────────────────────────────────────────────────────────
export type ProjectRow = { id: string; name: string; folder: string | null; icon: string | null; members: number; peers: number; default_dir: string | null };
export async function projects(ctx: Ctx, archived = false): Promise<ProjectRow[]> {
  const rows = await sel<{ id: string; title: string; default_dir: string | null }>(ctx,
    `SELECT id, title, default_dir FROM projects WHERE archived_at IS ${archived ? "NOT " : ""}NULL ORDER BY title`).catch(() => []);
  return rows.map((r) => ({ id: r.id, name: r.title, folder: null, icon: null, members: 1, peers: 0, default_dir: r.default_dir }));
}

// ── canvas items ───────────────────────────────────────────────────────
export type CanvasItem = { id: string; kind: string; title: string; version: number; state: string | null; position: number; updated_at: string };
export async function canvasItems(ctx: Ctx, agentId: string): Promise<CanvasItem[]> {
  return sel<CanvasItem>(ctx, `SELECT id, kind, title, version, state, position, updated_at FROM canvas_items
    WHERE agent_id = ? AND closed_at IS NULL ORDER BY position, created_at`, [agentId]).catch(() => []);
}

/** A message the interface wrote for the person (a comment, "what changed?") carries what the agent needs in a
 *  trailing <speca-context> block: the log shows the person's words, and each "- " line of the block as a chip. */
export function splitContext(raw: string): { text: string; context: Array<{ kind: string; title: string }> } {
  const m = raw.match(/\n*<speca-context>\n?([\s\S]*?)<\/speca-context>\s*$/);
  if (!m) return { text: raw, context: [] };
  const context = m[1]!.split("\n").filter((l) => l.startsWith("- ")).map((l) => ({ kind: "context", title: l.slice(2).replace(/\s*\((?:tab|comment) [^)]*\)$/, "").replace(/^canvas tab /, "").trim() }));
  return { text: raw.slice(0, m.index).trimEnd(), context };
}

/** The person's words with what the agent needs about them (see splitContext). */
export function withContext(text: string, lines: string[], note = ""): string {
  return `${text}\n\n<speca-context>\n${lines.map((l) => `- ${l}`).join("\n")}${note ? `\n${note}` : ""}\n</speca-context>`;
}
