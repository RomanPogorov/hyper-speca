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
    test("watch: a crash while writing the message leaves the job due, the retry delivers exactly once", async () => {
        const ctx: any = await mkTestCtx();
        const a = await ctx.fns.agent.start({ model: "mock:test" });
        ctx.state.registry.agent.watchPredicate = async () => ({ ready: true, result: { ok: 1 } });
        const w = await ctx.fns.agent.watch({ id: a.id, predicate: "file.exists", opts: { path: "x" }, prompt: "file x", everyMs: 5000 });
        failOn(ctx, "INSERT INTO messages");
        await ctx.fns.jobs.poll({ now: w.nextAt + 1 });
        const kept = (await ctx.fns.procs.db.select({ sql: "SELECT status, lease_token FROM jobs WHERE id = ?", params: [w.id] }))[0];
        expect(kept.status).toBe("running");
        expect(await userMessages(ctx, a.id)).toHaveLength(0);
        // the failed pass rescheduled it (next_at + 10 s); the next due pass delivers once and completes the watch
        await ctx.fns.jobs.poll({ now: w.nextAt + 20_000 });
        expect((await ctx.fns.ui.automationRows({ id: a.id, status: "all" }))[0].status).toBe("completed");
        await ctx.fns.jobs.poll({ now: w.nextAt + 120_000 });
        expect(await userMessages(ctx, a.id)).toHaveLength(1);
    });

    test("trigger: a pass that delivered but crashed before finalizing is not delivered twice", async () => {
        const ctx: any = await mkTestCtx();
        const a = await ctx.fns.agent.start({ model: "mock:test" });
        const t = await ctx.fns.agent.wake({ id: a.id, at: Date.now() + 60_000, prompt: "later" });
        const original = ctx.state.registry.agent.deliver;
        let crashOnce = true;
        ctx.state.registry.agent.deliver = async (c: any, s: any, o: any) => {
            if (!crashOnce) return original(c, s, o);
            crashOnce = false;
            // deliver the message (receipt written) without running the job's before/after guard → simulate a crash after the message
            await original(c, s, { ...o, before: undefined, after: undefined });
            throw new Error("injected crash");
        };
        await ctx.fns.jobs.poll({ now: t.nextAt + 1 });
        await ctx.fns.jobs.poll({ now: t.nextAt + 20_000 });
        expect(await userMessages(ctx, a.id)).toHaveLength(1);
        expect((await ctx.fns.ui.automationRows({ id: a.id, status: "all" }))[0].status).toBe("completed");
    });

    test("trigger: a cancel committed before delivery wins", async () => {
        const ctx: any = await mkTestCtx();
        const a = await ctx.fns.agent.start({ model: "mock:test" });
        const t = await ctx.fns.agent.wake({ id: a.id, at: Date.now() + 60_000, prompt: "later" });
        const original = ctx.state.registry.agent.deliver;
        ctx.state.registry.agent.deliver = async (c: any, s: any, o: any) => {
            await ctx.fns.jobs.cancel({ id: t.id });
            return original(c, s, o);
        };
        await ctx.fns.jobs.poll({ now: t.nextAt + 1 });
        expect(await userMessages(ctx, a.id)).toHaveLength(0);
        expect((await ctx.fns.ui.automationRows({ id: a.id, status: "all" }))[0].status).toBe("cancelled");
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
