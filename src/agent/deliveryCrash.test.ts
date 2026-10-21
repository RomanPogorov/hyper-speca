// Regression tests for the step-0 delivery fixes: every runtime delivery path now commits
// its state change and the inbox message in ONE transaction (agent.deliver), so a failure
// in the middle neither loses the wake nor delivers it twice on retry.
import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

const failOn = (ctx: any, prefix: string) => {
    const original = ctx.state.registry.procs.db.run;
    let armed = true;
    ctx.state.registry.procs.db.run = async (c: any, s: any, o: any) => {
        if (armed && String(o.sql).startsWith(prefix)) { armed = false; throw new Error("injected crash"); }
        return original(c, s, o);
    };
};
const userMessages = async (ctx: any, id: string) =>
    (await ctx.fns.session.getMessages({ id })).filter((m: any) => m.role === "user");

describe("delivery is atomic", () => {
    test("deliverWakes: a crash while writing the message keeps wake_at, the retry delivers exactly once", async () => {
        const ctx: any = await mkTestCtx();
        const a = await ctx.fns.agent.start({ model: "mock:test" });
        await ctx.fns.procs.db.run({ sql: "UPDATE agents SET wake_at = 1000, wake_reason = 'check' WHERE id = ?", params: [a.id] });
        failOn(ctx, "INSERT INTO messages");
        await expect(ctx.fns.agent.deliverWakes({ now: 2000 })).rejects.toThrow("injected crash");
        const kept = (await ctx.fns.procs.db.select({ sql: "SELECT wake_at FROM agents WHERE id = ?", params: [a.id] }))[0];
        expect(Number(kept.wake_at)).toBe(1000);
        expect(await userMessages(ctx, a.id)).toHaveLength(0);
        expect((await ctx.fns.agent.deliverWakes({ now: 2000 })).delivered).toEqual([a.id]);
        expect((await ctx.fns.agent.deliverWakes({ now: 3000 })).delivered).toEqual([]);
        const msgs = await userMessages(ctx, a.id);
        expect(msgs).toHaveLength(1);
        expect(msgs[0]).toMatchObject({ content: "Wake-up: check", message_type: "wake_up" });
        expect(msgs[0].excluded_from_cursor ?? false).toBe(false);
    });

    test("deliverWatch: a crash while writing the message leaves the watch claimable, not completed", async () => {
        const ctx: any = await mkTestCtx();
        const a = await ctx.fns.agent.start({ model: "mock:test" });
        ctx.state.registry.agent.watchPredicate = async () => ({ ready: true, result: { ok: 1 } });
        await ctx.fns.procs.db.run({
            sql: "INSERT INTO agent_watches (id, agent_id, predicate, opts, reason, interval_ms, next_check_at, timeout_at, status, attempts, created_at) VALUES ('w1', ?, 'file.exists', '{}', 'file x', 5000, 0, 9999999999999, 'checking', 0, 0)",
            params: [a.id],
        });
        failOn(ctx, "INSERT INTO messages");
        await expect(ctx.fns.agent.deliverWatch({ watchId: "w1", claimed: true, now: 10 })).rejects.toThrow("injected crash");
        expect((await ctx.fns.procs.db.select({ sql: "SELECT status FROM agent_watches WHERE id = 'w1'" }))[0].status).toBe("checking");
        expect((await ctx.fns.agent.deliverWatch({ watchId: "w1", claimed: true, now: 10 })).status).toBe("ready");
        expect((await ctx.fns.procs.db.select({ sql: "SELECT status FROM agent_watches WHERE id = 'w1'" }))[0].status).toBe("completed");
        expect(await userMessages(ctx, a.id)).toHaveLength(1);
    });

    test("trigger: a retry of the same occurrence after delivery is a duplicate, not a second prompt", async () => {
        const ctx: any = await mkTestCtx();
        const a = await ctx.fns.agent.start({ model: "mock:test" });
        const t = await ctx.fns.agent.wake({ id: a.id, at: Date.now() + 60_000, prompt: "later" });
        await ctx.fns.procs.db.run({ sql: "UPDATE agent_triggers SET status='checking', claim_token='c1', claimed_at=1 WHERE id=?", params: [t.id] });
        const once = { triggerId: t.id, claimToken: "c1", prompt: "later", now: 5, occurrence: 100 };
        expect(await ctx.fns.agent.deliverTriggerPrompt(once)).toBe(true);
        expect(await ctx.fns.agent.deliverTriggerPrompt(once)).toBe(true);
        expect(await userMessages(ctx, a.id)).toHaveLength(1);
    });

    test("trigger: a cancel committed before delivery wins", async () => {
        const ctx: any = await mkTestCtx();
        const a = await ctx.fns.agent.start({ model: "mock:test" });
        const t = await ctx.fns.agent.wake({ id: a.id, at: Date.now() + 60_000, prompt: "later" });
        await ctx.fns.procs.db.run({ sql: "UPDATE agent_triggers SET status='cancelled', claim_token='c1' WHERE id=?", params: [t.id] });
        expect(await ctx.fns.agent.deliverTriggerPrompt({ triggerId: t.id, claimToken: "c1", prompt: "later", now: 5 })).toBe(false);
        expect(await userMessages(ctx, a.id)).toHaveLength(0);
    });

    test("attachment: a crash while writing the message leaves the delivery retryable; the retry delivers once", async () => {
        const ctx: any = await mkTestCtx();
        const a = await ctx.fns.agent.start({ model: "mock:test" });
        ctx.state.attachments = { declarations: { demo: { events: ["message.new"], start: async () => ({ stop() {} }) } }, running: {} };
        ctx.state.registry.agent.startAttachments = async () => ({ started: [] });
        const att = await ctx.fns.agent.attach({ id: a.id, source: "demo", events: ["message.new"], prompt: "New" });
        ctx.state.registry.agent.dispatchAttachment = async () => ({ outcome: "skipped" });
        await ctx.fns.agent.emitAttachment({ source: "demo", eventId: "e1", eventType: "message.new", payload: { text: "hi" } });
        const delivery = (await ctx.fns.procs.db.select({ sql: "SELECT id, status FROM attachment_deliveries WHERE attachment_id = ?", params: [att.id] }))[0];
        expect(delivery.status).toBe("pending");
        delete ctx.state.registry.agent.dispatchAttachment;
        const dispatch = (await import("./dispatchAttachment")).default;
        ctx.state.registry.agent.dispatchAttachment = dispatch;
        failOn(ctx, "INSERT INTO messages");
        await expect(ctx.fns.agent.dispatchAttachment({ deliveryId: Number(delivery.id) })).rejects.toThrow("injected crash");
        expect((await ctx.fns.procs.db.select({ sql: "SELECT status FROM attachment_deliveries WHERE id = ?", params: [delivery.id] }))[0].status).toBe("failed");
        expect(await userMessages(ctx, a.id)).toHaveLength(0);
        expect(await ctx.fns.agent.dispatchAttachment({ deliveryId: Number(delivery.id) })).toEqual({ outcome: "delivered" });
        expect(await ctx.fns.agent.dispatchAttachment({ deliveryId: Number(delivery.id) })).toEqual({ outcome: "missing" });
        expect(await userMessages(ctx, a.id)).toHaveLength(1);
    });

    test("steer: team update message and parent schedule land together", async () => {
        const ctx: any = await mkTestCtx();
        const parent = await ctx.fns.agent.start({ model: "mock:test" });
        await ctx.fns.procs.db.run({ sql: "UPDATE agents SET next_run_at = NULL WHERE id = ?", params: [parent.id] });
        const r = await ctx.fns.agent.steer({ from: { id: "kid", parentId: parent.id, scratchpad: {} } as any, event: "task.completed", summary: "done" });
        expect(r).toMatchObject({ delivered: true, parentId: parent.id, messageIdx: 0 });
        const row = (await ctx.fns.procs.db.select({ sql: "SELECT next_run_at FROM agents WHERE id = ?", params: [parent.id] }))[0];
        expect(row.next_run_at).not.toBeNull();
        expect((await userMessages(ctx, parent.id))[0]).toMatchObject({ message_type: "team_update", author: "agent:kid" });
    });
});
