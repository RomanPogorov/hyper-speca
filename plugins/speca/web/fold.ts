// fold(events) → turns → items. A pure function: a full load, older pages and appended tails give the same HTML.
// Items are keyed by family ids (call_id, approval_id, question_id), so a late result replaces its own node.
import type { EventRow } from "./types.ts";

export type Call = { id: string; name: string; args: Record<string, unknown>; status: "queued" | "started" | "done"; text: string; isError: boolean; reason?: string | null; meta: Record<string, any> | null; startedAt?: number; finishedAt?: number };

export type Item =
  | { k: "user"; idx: number; text: string; author: string | null; authorName?: string | null; context: Array<{ kind: string; title: string }>; attachments: Array<{ id: string; name: string; mime: string }>; ts: Date; steer: boolean }
  | { k: "assistant"; idx: number; text: string; streaming: boolean; interrupted: boolean; model: string | null; final?: boolean }
  | { k: "tools"; id: string; calls: Call[] }
  | { k: "approval"; id: string; idx: number; d: Record<string, any>; status: string | null; ts: Date; decidedAt: Date | null }
  | { k: "plan_review"; id: string; idx: number; d: Record<string, any>; status: string | null }
  | { k: "question"; id: string; idx: number; d: Record<string, any>; answers: unknown | null }
  | { k: "canvas"; idx: number; d: Record<string, any> }
  | { k: "changes"; idx: number; d: Record<string, any> }
  | { k: "git"; idx: number; d: Record<string, any> }
  | { k: "ask_sent"; idx: number; d: Record<string, any> }
  | { k: "ask_answer"; idx: number; d: Record<string, any> }
  | { k: "access_request"; idx: number; d: Record<string, any> }
  | { k: "notice"; idx: number; d: Record<string, any> }
  | { k: "note"; idx: number; d: Record<string, any> }
  | { k: "subagent"; idx: number; d: Record<string, any> }
  | { k: "subagent_result"; idx: number; d: Record<string, any> }
  | { k: "btw"; idx: number; d: Record<string, any> }
  | { k: "usage"; idx: number; d: Record<string, any> }
  | { k: "merged"; idx: number; d: Record<string, any> };

/** A place on a canvas a tool changed (a tool result's `meta.places`): the tab, the part of it (a design canvas's
 *  artboard), its name — the chat shows a way to each under the turn. */
export type Place = { tabId: string; focus?: string; title: string };
export type Turn = { id: string; startIdx: number; lastIdx: number; open: boolean; reason: string | null; error: string | null; ms: number | null; tokens: { in: number; cached: number; out: number; models?: Array<{ model: string; n: number }> } | null; started: Date; items: Item[]; steered: boolean; places: Place[] };

export function fold(events: EventRow[]): Turn[] {
  const turns: Turn[] = [];
  let cur: Turn | null = null;
  let group: { k: "tools"; id: string; calls: Call[] } | null = null;
  const calls = new Map<string, Call>();
  const byFamily = new Map<string, Item>();

  const ensureTurn = (e: EventRow): Turn => {
    if (cur) return cur;
    cur = { id: `pre${e.idx}`, startIdx: e.idx, lastIdx: e.idx, open: false, reason: null, error: null, ms: null, tokens: null, started: new Date(e.ts), items: [], steered: false, places: [] };
    turns.push(cur);
    return cur;
  };
  const push = (t: Turn, it: Item) => { t.items.push(it); };
  const endGroup = () => { group = null; };
  const callOf = (t: Turn, id: string, name: string): Call => {
    let c = calls.get(id);
    if (c) return c;
    c = { id, name, args: {}, status: "queued", text: "", isError: false, meta: null };
    calls.set(id, c);
    if (!group) { group = { k: "tools", id: `g-${id}`, calls: [] }; push(t, group); }
    group.calls.push(c);
    return c;
  };

  for (const e of events) {
    const d = e.data ?? {};
    // a fork copies the parent log up to a message, often before that turn's turn_end: the inherited turn is over
    if (cur?.open && (e.type === "turn_start" || (e.type === "notice" && e.data?.kind === "forked"))) {
      cur.open = false; cur.reason = "completed";
      endGroup();
      if (e.type === "notice") cur = null;
    }
    if (e.type === "turn_start") {
      cur = { id: String(d.turnId ?? `t${e.idx}`), startIdx: e.idx, lastIdx: e.idx, open: true, reason: null, error: null, ms: null, tokens: null, started: new Date(e.ts), items: [], steered: false, places: [] };
      turns.push(cur);
      endGroup();
      continue;
    }
    const t = ensureTurn(e);
    t.lastIdx = Math.max(t.lastIdx, e.idx);
    switch (e.type) {
      case "turn_end":
        t.open = false; t.reason = d.reason ?? null; t.error = d.error ?? null; t.ms = d.ms ?? null; t.tokens = d.tokens ?? null;
        endGroup();
        cur = null;
        break;
      case "user_message": {
        endGroup();
        const hasAssistant = t.items.some((i) => i.k === "assistant" || i.k === "tools");
        if (hasAssistant) t.steered = true;
        push(t, { k: "user", idx: e.idx, text: String(d.text ?? ""), author: d.author ?? null, authorName: d.authorName ?? null, context: d.context ?? [], attachments: d.attachments ?? [], ts: new Date(e.ts), steer: hasAssistant });
        break;
      }
      case "assistant_draft":
      case "assistant_message": {
        const text = String(d.text ?? "");
        if (text) {
          endGroup();
          push(t, { k: "assistant", idx: e.idx, text, streaming: e.type === "assistant_draft", interrupted: !!d.interrupted, model: d.model ?? null });
        }
        for (const c of (d.toolCalls ?? []) as Array<{ id: string; name: string; args: Record<string, unknown> }>) {
          const call = callOf(t, c.id, c.name);
          call.name = c.name;
          call.args = c.args ?? {};
        }
        break;
      }
      case "tool_result": {
        const call = callOf(t, String(d.callId), String(d.name ?? "tool"));
        if (d.name && d.name !== "tool") call.name = d.name;
        call.status = d.status ?? "done";
        call.text = String(d.text ?? "");
        call.isError = !!d.isError;
        call.meta = d.meta ?? null;
        call.reason = d.reason ?? null;
        call.startedAt = d.startedAt; call.finishedAt = d.finishedAt;
        // where on a canvas it changed something (latest last, each place once)
        for (const p of (d.meta?.places ?? []) as Place[]) {
          if (!p?.tabId || !p.title) continue;
          t.places = t.places.filter((x) => !(x.tabId === p.tabId && x.focus === p.focus));
          t.places.push({ tabId: String(p.tabId), focus: p.focus ? String(p.focus) : undefined, title: String(p.title).slice(0, 120) });
        }
        break;
      }
      case "approval_request": {
        endGroup();
        const it: Item = { k: "approval", id: String(d.approvalId), idx: e.idx, d, status: null, ts: new Date(e.ts), decidedAt: null };
        byFamily.set(String(d.approvalId), it);
        push(t, it);
        break;
      }
      case "plan_review": {
        endGroup();
        const it: Item = { k: "plan_review", id: String(d.approvalId), idx: e.idx, d, status: null };
        byFamily.set(String(d.approvalId), it);
        push(t, it);
        break;
      }
      case "approval_decided": {
        const it = byFamily.get(String(d.approvalId));
        if (it && (it.k === "approval" || it.k === "plan_review")) {
          it.status = d.status;
          if (it.k === "approval") it.decidedAt = new Date(e.ts);
        }
        break;
      }
      case "question": {
        endGroup();
        const it: Item = { k: "question", id: String(d.questionId), idx: e.idx, d, answers: null };
        byFamily.set(String(d.questionId), it);
        push(t, it);
        break;
      }
      case "question_answer": {
        const it = byFamily.get(String(e.family));
        if (it && it.k === "question") it.answers = d.answers;
        break;
      }
      case "canvas_opened": endGroup(); push(t, { k: "canvas", idx: e.idx, d }); break;
      case "turn_changes": endGroup(); push(t, { k: "changes", idx: e.idx, d }); break;
      case "git": endGroup(); push(t, { k: "git", idx: e.idx, d }); break;
      case "ask_sent": endGroup(); push(t, { k: "ask_sent", idx: e.idx, d }); break;
      case "ask_answer": endGroup(); push(t, { k: "ask_answer", idx: e.idx, d }); break;
      case "subagent_started": endGroup(); push(t, { k: "subagent", idx: e.idx, d }); break;
      case "subagent_result": endGroup(); push(t, { k: "subagent_result", idx: e.idx, d }); break;
      case "access_request": endGroup(); push(t, { k: "access_request", idx: e.idx, d }); break;
      case "notice": endGroup(); push(t, { k: "notice", idx: e.idx, d }); break;
      case "branch_merged": endGroup(); push(t, { k: "merged", idx: e.idx, d }); break;
      case "side_question": endGroup(); push(t, { k: "btw", idx: e.idx, d }); break;
      case "plan_usage": endGroup(); push(t, { k: "usage", idx: e.idx, d }); break;
      case "inbox_note": endGroup(); push(t, { k: "note", idx: e.idx, d }); break;
      // a turn picked up again after Speca restarted mid-turn (worker.ts recover): the person sees a line, not the note
      case "system_note": if (d.resume) { endGroup(); push(t, { k: "note", idx: e.idx, d: { kind: "resume" } }); } break;
      default: break; // request_header, state_snapshot, step_*, system_note, plan_write: not shown
    }
  }
  // the last assistant text of a completed turn is its answer
  for (const t of turns) {
    const last = [...t.items].reverse().find((i) => i.k === "assistant");
    if (last && last.k === "assistant") last.final = true;
  }
  // a call still "started" in a closed turn was cut off (stop, restart): show it as interrupted, not spinning
  for (const t of turns) if (!t.open) for (const i of t.items) if (i.k === "tools") for (const c of i.calls) {
    if (c.status !== "done") { c.status = "done"; c.isError = true; c.text ||= "Interrupted — the result is unknown."; c.meta = { ...c.meta, unknown: true }; }
  }
  return turns;
}

/** A completed turn without interventions collapses its work; cancelled / failed / steered turns stay open. */
export function collapses(t: Turn): boolean {
  return !t.open && t.reason === "completed" && !t.steered && t.items.some((i) => i.k === "tools" || (i.k === "assistant" && !i.final));
}
