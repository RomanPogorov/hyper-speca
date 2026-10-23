import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

describe("jobs.cancelAgent", () => {
    test("archiving an agent cancels its wake-ups, schedules and subscriptions, not other agents' jobs", async () => {
        const ctx: any = await mkTestCtx();
        const a = await ctx.fns.agent.start({ model: "mock:test" });
        const b = await ctx.fns.agent.start({ model: "mock:test" });
        let stopped = 0;
        ctx.state.attachments = { declarations: { demo: { events: ["message.new"], start: async () => ({ stop() { stopped++; } }) } }, running: {} };
        const wake = await ctx.fns.agent.wake({ id: a.id, inMs: 60_000, prompt: "later" });
        const cron = await ctx.fns.agent.cron({ id: a.id, expression: "0 9 * * *", timezone: "UTC", prompt: "daily" });
        const att = await ctx.fns.agent.attach({ id: a.id, source: "demo" });
        const other = await ctx.fns.agent.wake({ id: b.id, inMs: 60_000, prompt: "keep me" });

        await ctx.fns.session.archive({ id: a.id });

        const rows = await ctx.fns.procs.db.select({ sql: "SELECT id, status, outcome_reason FROM jobs WHERE id IN (?, ?, ?, ?)", params: [wake.id, cron.id, att.id, other.id] }) as any[];
        const by = Object.fromEntries(rows.map((r: any) => [r.id, r]));
        expect(by[wake.id]).toMatchObject({ status: "cancelled", outcome_reason: "cancelled" });
        expect(by[cron.id].status).toBe("cancelled");
        expect(by[att.id].status).toBe("cancelled");
        expect(by[other.id].status).toBe("running");
        expect(stopped).toBe(1);
        expect((await ctx.fns.agent.emitAttachment({ source: "demo", eventId: "x", eventType: "message.new", payload: {} })).deliveries).toBe(0);
    });
});
