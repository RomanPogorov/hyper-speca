// Speca's confirmations in Hyper. Every tool call of an agent passes Hyper's `tools.gate` point (src/tools/call.ts);
// here it is weighed as Speca's pipeline does (core/runtime/tools/pipeline.ts precheck): the chat's mode (plan: only
// reading) and autonomy (read only · ask before changes · drafts · full access), the call's effect class
// (web/effects.ts). A call that needs the person waits on an approval card in the chat (approval_request → the
// person's decision at POST /speca/approvals/:id → approval_decided) — and so do a plan put up in plan mode
// (speca.planPropose: the plan_review card) and questions to the person (speca.askUser: the question card).
import { classify, type Effect } from "./effects.ts";
import { makeT, type Locale } from "./i18n/i18n.ts";

type H = { fns: any; state?: any };
const sel = async <R = any>(h: H, sql: string, params: unknown[] = []): Promise<R[]> => (await h.fns.procs.db.select({ sql, params })) as R[];
const exec = (h: H, sql: string, params: unknown[] = []) => h.fns.procs.db.run({ sql, params });
const json = (v: unknown) => { try { return typeof v === "string" ? JSON.parse(v) : (v ?? {}); } catch { return {}; } };

export type Status = "approved" | "rejected" | "cancelled" | "expired";
export type Kind = "local" | "effect" | "plan" | "question";
/** How long a card waits for the person before the action is dropped. */
const WAIT_MS = 30 * 60_000;
/** The person wrote a message instead of deciding: that is the answer. */
export const WROTE_INSTEAD = "wrote_instead";

// waiting calls in this process, woken by a decision (a poll covers anything missed)
const waiters: Map<string, () => void> = ((globalThis as any).__specaApprovalWaiters ??= new Map());
// cards a call is waiting on in this process: one pending in the table but not here was left by a restart
const live: Set<string> = ((globalThis as any).__specaApprovalLive ??= new Set());

/** The chat a call belongs to: the agent's own, or — a subagent — the chat that started it, with that chat's mode and
 *  autonomy and its owner's settings. */
export async function chatFor(h: H, agentId: string) {
  let id = agentId;
  for (let i = 0; i < 6; i++) {
    const [a] = await sel<{ parent_id: string | null; scratchpad: any }>(h, `SELECT parent_id, scratchpad FROM agents WHERE id = ?`, [id]);
    if (!a?.parent_id || !json(a.scratchpad)?.delegation) break;
    id = a.parent_id;
  }
  const [c] = await sel<{ autonomy: string | null; mode: string | null; user_id: string }>(h,
    `SELECT autonomy, mode, user_id FROM speca_chat WHERE agent_id = ? ORDER BY (autonomy IS NULL) LIMIT 1`, [id]);
  const [u] = await sel<{ settings: any }>(h, c ? `SELECT settings FROM speca_user WHERE user_id = ?` : `SELECT settings FROM speca_user LIMIT 1`, c ? [c.user_id] : []);
  const settings = json(u?.settings);
  return {
    chatId: id, sub: id !== agentId,
    autonomy: (c?.autonomy ?? settings.defaultAutonomy ?? "full") as "read_only" | "ask" | "drafts" | "full",
    mode: (c?.mode ?? "work") as "work" | "plan",
    askIrreversible: settings.askIrreversible !== false,
    rules: String(settings.agentRules ?? "").trim(),
    locale: (settings.locale === "en" ? "en" : "ru") as Locale,
  };
}

const refresh = (h: H, ...ids: string[]) => { for (const id of new Set(ids)) try { h.fns.procs.events.refresh({ topic: `agent:${id}`, reason: "speca-approval" }); } catch { /* no bus */ } };
async function append(h: H, chat: { chatId: string; sub: boolean }, agentId: string, event: Record<string, unknown>): Promise<number> {
  // a subagent's card is in its own log; the parent chat shows it on the subagent's card (route sub/:id/card)
  const { idx } = await h.fns.session.appendEvent({ id: agentId, event: { ...event } });
  refresh(h, agentId, chat.chatId);
  return idx;
}

/** The gate: null lets the call run; { deny } is what the model reads instead. */
export async function gate(h: H, o: { agentId: string; tool: string; args: any; signal?: AbortSignal }): Promise<null | { deny: string }> {
  const chat = await chatFor(h, o.agentId);
  const t = makeT(chat.locale) as any;
  const call = classify(o.tool, o.args ?? {}, t);
  const cls: Effect = call.effect;
  if (cls === "read") return null;
  if (chat.mode === "plan") {
    return { deny: `${o.tool} is not available in plan mode (it ${cls === "own_write" ? "changes things" : "acts outside the workspace"}). Only read now. Propose the plan with ctx.fns.speca.planPropose({ markdown }) — markdown starting with "# "; the person approves it and the chat switches to work mode.` };
  }
  let need: "local" | "effect" | null = null;
  if (chat.autonomy === "full") {
    if (cls !== "irreversible" || !chat.askIrreversible) return null;
    need = "effect";
  } else if (cls === "own_write") {
    if (chat.autonomy === "read_only") return { deny: `${o.tool} changes things, and this chat is read-only. Describe what you would do instead.` };
    if (chat.autonomy === "ask") need = "local";
  } else need = "effect";
  if (!need) return null;
  const status = await ask(h, chat, {
    agentId: o.agentId, kind: need, tool: o.tool, effect: cls, plugin: call.plugin, summary: call.summary,
    preview: { items: call.items.length ? call.items : [call.summary], args: o.args ?? {} }, why: call.why, signal: o.signal,
  });
  if (status.status === "approved") return null;
  if (status.status === "rejected" && status.note === WROTE_INSTEAD) {
    return { deny: "Not done: instead of confirming, the person wrote to you (their message follows). Answer it first. Propose this action again only if it is still needed, explaining it in plain words." };
  }
  return { deny: {
    rejected: "The person rejected this action. Do not retry it; ask what to change if needed.",
    cancelled: "The confirmation was cancelled (the call or the turn was stopped). The action was not done.",
    expired: "Nobody confirmed this action in time. It was not done.",
  }[status.status as Exclude<Status, "approved">] ?? "Not done." };
}

type AskOpts = {
  agentId: string; kind: Kind; tool?: string | null; effect?: Effect | null; plugin?: string | null; summary: string;
  preview: Record<string, unknown>; why?: string | null; signal?: AbortSignal;
  /** How long the card waits (default 30 minutes). */
  waitMs?: number;
  /** The event the card is drawn from (default approval_request). */
  event?: Record<string, unknown>;
};

/** Put one decision to the person and wait for it. */
export async function ask(h: H, chat: Awaited<ReturnType<typeof chatFor>>, o: AskOpts): Promise<{ id: string; status: Status; note: string | null; answer: any }> {
  const id = `apr_${Bun.randomUUIDv7()}`;
  const hash = Bun.hash(JSON.stringify([o.kind, o.tool ?? null, o.preview])).toString(36);
  const now = Date.now();
  await exec(h, `INSERT INTO speca_approvals (id, agent_id, chat_id, kind, tool, effect, plugin, summary, preview, preview_hash, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?)`,
    [id, o.agentId, chat.chatId, o.kind, o.tool ?? null, o.effect ?? null, o.plugin ?? null, o.summary, JSON.stringify(o.preview), hash, now, now + (o.waitMs ?? WAIT_MS)]);
  const event = o.event ? { ...o.event } : {
    type: "approval_request", approvalId: id, tool: o.tool, wire: o.tool, plugin: o.plugin ?? undefined, effect: o.effect, kind: o.kind,
    summary: o.summary, items: (o.preview as any).items ?? [], previewHash: hash, ...(o.why ? { why: o.why } : {}),
  };
  if (o.event) Object.assign(event, { approvalId: id, questionId: id, previewHash: hash });
  live.add(id);
  let status: Status;
  try {
    const at = await append(h, chat, o.agentId, event);
    status = await waitFor(h, id, chat.chatId, at, o.signal);
  } finally { live.delete(id); }
  const [row] = await sel<{ note: string | null; answer: any }>(h, `SELECT note, answer FROM speca_approvals WHERE id = ?`, [id]);
  await append(h, chat, o.agentId, { type: o.kind === "question" ? "question_answer" : "approval_decided", approvalId: id, questionId: id, status, ...(o.kind === "question" ? { answers: json(row?.answer) } : {}) });
  return { id, status, note: row?.note ?? null, answer: row?.answer ? json(row.answer) : null };
}

async function settle(h: H, id: string, status: Status, note: string | null = null): Promise<void> {
  await exec(h, `UPDATE speca_approvals SET status = ?, note = coalesce(?, note), decided_at = ? WHERE id = ? AND status = 'pending'`, [status, note, Date.now(), id]);
}

async function waitFor(h: H, id: string, chatId: string, afterIdx: number, signal?: AbortSignal): Promise<Status> {
  const start = Date.now();
  for (;;) {
    const [r] = await sel<{ status: string; expires_at: string | null }>(h, `SELECT status, expires_at FROM speca_approvals WHERE id = ?`, [id]);
    if (!r) return "cancelled";
    if (r.status !== "pending") return r.status as Status;
    if (signal?.aborted) { await settle(h, id, "cancelled"); continue; }
    if (Date.now() > Number(r.expires_at ?? start + WAIT_MS)) { await settle(h, id, "expired"); continue; }
    // a message of the person after the card: their words are the answer
    const wrote = await sel(h, `SELECT 1 FROM events WHERE agent_id = ? AND idx > ? AND type = 'user' LIMIT 1`, [chatId, afterIdx]);
    if (wrote.length) { await settle(h, id, "rejected", WROTE_INSTEAD); continue; }
    await new Promise<void>((res) => {
      const done = () => { clearTimeout(tm); waiters.delete(id); signal?.removeEventListener("abort", done); res(); };
      const tm = setTimeout(done, 1500);
      waiters.set(id, done);
      signal?.addEventListener("abort", done, { once: true });
    });
  }
}

export class ApprovalError extends Error { constructor(public code: "not_pending" | "preview_mismatch" | "expired" | "not_found") { super(code); } }

/** The person's decision on a card (POST /speca/approvals/:id). */
export async function decide(h: H, id: string, decision: "approved" | "rejected", hash: string, note?: string | null, answer?: unknown): Promise<{ kind: Kind; chatId: string; agentId: string }> {
  const [r] = await sel<{ status: string; preview_hash: string; expires_at: string | null; kind: Kind; chat_id: string; agent_id: string }>(h,
    `SELECT status, preview_hash, expires_at, kind, chat_id, agent_id FROM speca_approvals WHERE id = ?`, [id]);
  if (!r) throw new ApprovalError("not_found");
  if (r.status !== "pending") throw new ApprovalError("not_pending");
  if (!live.has(id)) {
    // nobody waits for it any more (the server restarted): the card closes as cancelled
    await settle(h, id, "cancelled");
    await h.fns.session.appendEvent({ id: r.agent_id, event: { type: r.kind === "question" ? "question_answer" : "approval_decided", approvalId: id, questionId: id, status: "cancelled" } }).catch(() => {});
    refresh(h, r.chat_id);
    throw new ApprovalError("not_pending");
  }
  if (hash && r.preview_hash !== hash) throw new ApprovalError("preview_mismatch");
  if (r.expires_at && Date.now() > Number(r.expires_at)) throw new ApprovalError("expired");
  await exec(h, `UPDATE speca_approvals SET status = ?, note = ?, answer = ?::jsonb, decided_at = ? WHERE id = ? AND status = 'pending'`,
    [decision, note ?? null, answer === undefined ? null : JSON.stringify(answer), Date.now(), id]);
  waiters.get(id)?.();
  return { kind: r.kind, chatId: r.chat_id, agentId: r.agent_id };
}

/** Cards still waiting, for the agents dashboard and the chat list. */
export async function pending(h: H, o: { chatIds?: string[]; agentId?: string } = {}): Promise<Array<{ id: string; chat_id: string; agent_id: string; kind: Kind; summary: string; plugin: string | null; plugin_id: string | null; preview_hash: string; created_at: number; effect: string | null; items: string[] }>> {
  const { chatIds, agentId } = o;
  if (chatIds && !chatIds.length) return [];
  const rows = await sel(h, `SELECT id, chat_id, agent_id, kind, summary, plugin, plugin AS plugin_id, preview_hash, created_at, effect, preview->'items' AS items FROM speca_approvals WHERE status = 'pending'${chatIds ? ` AND chat_id IN (${chatIds.map(() => "?").join(", ")})` : ""}${agentId ? " AND agent_id = ?" : ""} ORDER BY created_at`, [...(chatIds ?? []), ...(agentId ? [agentId] : [])]);
  const list = (v: unknown) => (Array.isArray(v) ? v : typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return []; } })() : []).map(String);
  return rows.map((r: any) => ({ ...r, created_at: Number(r.created_at), items: list(r.items) }));
}

/** The signal that ends a wait started from an agent function (eval): its call stopped, or the agent. */
export function stopSignal(ctx: any, agentId: string): AbortSignal | undefined {
  const xs = [ctx?.toolRun?.controller?.signal, ctx?.state?.agent?.[agentId]?.abortController?.signal].filter(Boolean) as AbortSignal[];
  return xs.length ? AbortSignal.any(xs) : undefined;
}
