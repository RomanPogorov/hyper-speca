/**
 * Atomically deliver a runtime event into an agent inbox: message, UI event, replay receipt and wake schedule in one transaction
 *
 * Single entry point for runtime-originated inbox messages (triggers, wakes, watches, attachments, team updates,
 * background jobs). In ONE Postgres transaction it locks the recipient, runs an optional guard, checks the durable
 * replay receipt by key (survives transcript clear/truncate), inserts the user-role message and optional UI event,
 * records the receipt, schedules the worker and runs an optional after hook; then best-effort syncs live state,
 * refreshes the UI and wakes the worker. Messages count for the run cursor by default, so an event arriving during a
 * run triggers another pass. Internal runtime transport: it performs no caller authorization — use
 * session.enqueueNotification for authenticated user/agent/service notifications.
 * @param opts.to Recipient agent id; must exist. Archived recipients get the message but no wake.
 * @param opts.type messages.message_type and default UI event type, e.g. trigger, wake_up, team_update, attachment, job.
 * @param opts.text Nonempty message content shown to the model.
 * @param opts.key Stable per-recipient delivery key (max 500 chars). A repeated key returns duplicate:true and writes nothing, even after the transcript was cleared.
 * @param opts.source Transport label recorded on the receipt and used as the UI refresh reason. @default "runtime"
 * @param opts.author messages.author / events.actor; null (default) means runtime-originated.
 * @param opts.resultRef Durable stored result referenced by the message.
 * @param opts.event UI event payload appended in the same transaction; type defaults to opts.type, messageIdx is added.
 * @param opts.wake Scheduling policy. @default "keep"
 * @param opts.windowMs Coalescing window for wake=batch. @default 2000 @minimum 0 @maximum 60000
 * @param opts.excludedFromCursor Exclude the message from the run cursor. @default false
 * @param opts.section Meta panel section to refresh after commit.
 * @param opts.before Guard executed inside the transaction after the recipient lock.
 * @param opts.after Hook executed inside the same transaction after the insert.
 * @param opts.now Timestamp in ms; defaults to Date.now().
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Recipient agent id; must exist. Archived recipients get the message but no wake. */
        to: string;
        /** messages.message_type and default UI event type, e.g. trigger, wake_up, team_update, attachment, job. */
        type: string;
        /** Nonempty message content shown to the model. */
        text: string;
        /** Stable per-recipient delivery key (max 500 chars). A repeated key returns duplicate:true and writes nothing, even after the transcript was cleared. */
        key?: string;
        /** Transport label recorded on the receipt and used as the UI refresh reason. @default "runtime" */
        source?: string;
        /** messages.author / events.actor; null (default) means runtime-originated and is never shown as a human speaker. */
        author?: string | null;
        /** Durable stored result referenced by the message. */
        resultRef?: types.agent.ResultRef;
        /** UI event payload appended in the same transaction; type defaults to opts.type, messageIdx is added. */
        event?: Record<string, any>;
        /** keep = COALESCE(next_run_at, now), an existing schedule wins; now = run immediately even if a later run was scheduled; batch = the first event opens a fixed window of windowMs, later events do not move it; none = no schedule. @default "keep" */
        wake?: "keep" | "now" | "batch" | "none";
        /** Coalescing window for wake=batch, in milliseconds. @default 2000 @minimum 0 @maximum 60000 */
        windowMs?: number;
        /** Exclude the message from the run cursor (legacy synthetic rows). Default false so the worker never drops a wake for it. @default false */
        excludedFromCursor?: boolean;
        /** Meta panel section to refresh after commit. */
        section?: "goal" | "knowledge" | "automation" | "wake" | "team" | "plan" | "all";
        /** Guard executed inside the transaction after the recipient lock (e.g. claim/CAS on the source row); false aborts with reason "guard" and writes nothing. */
        before?: () => Promise<boolean>;
        /** Hook executed inside the same transaction after the insert (e.g. mark the source delivered); throwing rolls everything back. */
        after?: (r: { messageIdx: number; eventIdx: number | null }) => Promise<void>;
        /** Timestamp in ms; defaults to Date.now(). */
        now?: number;
    },
): Promise<{ delivered: boolean; duplicate: boolean; messageIdx: number | null; eventIdx: number | null; reason?: string }> {
    const to = String(opts.to ?? "").trim();
    const key = opts.key?.trim() || null;
    const type = String(opts.type ?? "").trim();
    if (!to || !type || typeof opts.text !== "string" || !opts.text.trim()) throw new Error("agent.deliver: to, type and nonempty text are required");
    if (key && key.length > 500) throw new Error("agent.deliver: key longer than 500 characters");
    const text = await ctx.fns.session.scrubUnicode({ text: opts.text });
    const source = String(opts.source ?? "runtime").slice(0, 200);
    const wake = opts.wake ?? "keep";
    const windowMs = Math.max(0, Math.min(60_000, Math.floor(opts.windowMs ?? 2000)));
    const payload = JSON.stringify({ type, text });
    type R = { delivered: boolean; duplicate: boolean; messageIdx: number | null; eventIdx: number | null; reason?: string };
    let out: R | undefined;
    for (let attempt = 0; attempt < 10; attempt++) {
        try {
            out = (await ctx.fns.procs.db.transaction({ fn: async (): Promise<R> => {
                const now = Math.floor(opts.now ?? Date.now());
                const target = (await ctx.fns.procs.db.select({ sql: "SELECT archived_at FROM agents WHERE id = ? FOR UPDATE", params: [to] }) as any[])[0];
                if (!target) throw new Error("agent.deliver: unknown agent " + to);
                if (opts.before && !(await opts.before())) return { delivered: false, duplicate: false, messageIdx: null, eventIdx: null, reason: "guard" };
                if (key) {
                    const prior = (await ctx.fns.procs.db.select({ sql: "SELECT message_idx, event_idx FROM session_notification_receipts WHERE agent_id = ? AND delivery_key = ?", params: [to, key] }) as any[])[0];
                    if (prior) return { delivered: false, duplicate: true, messageIdx: Number(prior.message_idx), eventIdx: Number(prior.event_idx) < 0 ? null : Number(prior.event_idx), reason: "duplicate" };
                }
                const msg = await ctx.fns.procs.db.run({
                    sql: "INSERT INTO messages (agent_id, idx, role, content, message_type, ts, excluded_from_llm, excluded_from_cursor, author, result_ref) SELECT ?, COALESCE(MAX(idx), -1) + 1, 'user', ?, ?, ?, 0, ?, ?, ?::jsonb FROM messages WHERE agent_id = ? RETURNING idx",
                    params: [to, text, type, now, opts.excludedFromCursor ? 1 : 0, opts.author ?? null, opts.resultRef ? JSON.stringify(opts.resultRef) : null, to],
                });
                const messageIdx = Number((msg.rows as any[])[0].idx);
                let eventIdx: number | null = null;
                if (opts.event) {
                    const event = { type, ...opts.event, messageIdx };
                    const evt = await ctx.fns.procs.db.run({
                        sql: "INSERT INTO events (agent_id, idx, type, payload, ts, actor) SELECT ?, COALESCE(MAX(idx), -1) + 1, ?, ?, ?, ? FROM events WHERE agent_id = ? RETURNING idx",
                        params: [to, String(event.type), JSON.stringify(event).replaceAll("\u0000", "\uFFFD"), now, opts.author ?? null, to],
                    });
                    eventIdx = Number((evt.rows as any[])[0].idx);
                }
                if (key) await ctx.fns.procs.db.run({
                    sql: "INSERT INTO session_notification_receipts (agent_id, delivery_key, payload, message_idx, event_idx, transport_actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    params: [to, key, payload, messageIdx, eventIdx ?? -1, source, now],
                });
                if (target.archived_at == null && wake !== "none") {
                    if (wake === "now") await ctx.fns.procs.db.run({ sql: "UPDATE agents SET next_run_at = LEAST(COALESCE(next_run_at, ?), ?), updated_at = ? WHERE id = ?", params: [now, now, now, to] });
                    else await ctx.fns.procs.db.run({ sql: "UPDATE agents SET next_run_at = COALESCE(next_run_at, ?), updated_at = ? WHERE id = ?", params: [wake === "batch" ? now + windowMs : now, now, to] });
                } else {
                    await ctx.fns.procs.db.run({ sql: "UPDATE agents SET updated_at = ? WHERE id = ?", params: [now, to] });
                }
                if (opts.after) await opts.after({ messageIdx, eventIdx });
                return { delivered: true, duplicate: false, messageIdx, eventIdx };
            } })) as R;
            break;
        } catch (error) {
            const message = String((error as any)?.message ?? error);
            // idx is allocated inside the insert; two concurrent writers can read the same MAX.
            // A concurrent delivery of the same key loses on the receipt PK — retry sees it as duplicate.
            const retryable = /messages_pkey|events_pkey/.test(message) || (!!key && /session_notification_receipts_pkey/.test(message));
            if (attempt === 9 || !retryable) throw error;
            await Bun.sleep(3 + Math.random() * 20 * (attempt + 1));
        }
    }
    if (!out) throw new Error("agent.deliver: retries exhausted");
    if (out.delivered) {
        try {
            const live = (ctx.state as any).agent?.[to];
            if (live) await ctx.fns.session.syncAgentState({ agent: live });
            await ctx.fns.agent.wakeWaiters({ agentId: to });
            ctx.fns.procs.events.refresh({ topic: "agent:" + to, reason: "deliver" });
            if (opts.section) ctx.fns.events.refreshAgentMeta({ agentId: to, section: opts.section, reason: source });
            if (wake !== "none") ctx.fns.agent.wakeWorker({});
        } catch (error) {
            await ctx.fns.procs.log.warn({ event: "agent.deliver.projection.failed", msg: String(error), agentId: to });
        }
    }
    return out;
}
