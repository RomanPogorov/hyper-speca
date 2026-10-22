import { test, expect, describe } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

describe("session.loadAll", () => {
    test("empty db → {loaded: 0}", async () => {
        const ctx: any = await mkTestCtx();
        expect((await ctx.fns.session.loadAll({})).loaded).toBe(0);
    });

    test("rehydrates only running or queued agents; an idle one loads on first use", async () => {
        const ctx: any = await mkTestCtx();
        ctx.fns.agent.renderEventHtml = async (_c: any, _s: any, _o: any) => '';
        const a = await ctx.fns.agent.start({ model: "m1" });
        await ctx.fns.session.save({ agent: a });
        await ctx.fns.session.appendUserMessage({ id: a.id, text: 'hi' });
        const b = await ctx.fns.agent.start({ model: "m2", systemPrompt: "sp" });
        await ctx.fns.session.save({ agent: b });
        const idle = await ctx.fns.agent.start({ model: "m3" });
        await ctx.fns.session.save({ agent: idle });
        await ctx.fns.procs.db.run({ sql: "UPDATE agents SET run_state = 'running' WHERE id = ?", params: [a.id] });
        await ctx.fns.procs.db.run({ sql: "UPDATE agents SET run_state = 'idle', next_run_at = ? WHERE id = ?", params: [Date.now(), b.id] });
        await ctx.fns.procs.db.run({ sql: "UPDATE agents SET run_state = 'idle', next_run_at = NULL WHERE id = ?", params: [idle.id] });

        // fresh ctx, same db — simulate restart by sharing the pg pool (the
        // pg_temp schema follows the connection).
        const ctx2: any = await mkTestCtx();
        ((ctx2.state as any).procs ??= {}).db = { ...((ctx2.state as any).procs.db ?? {}), sql: await ctx.fns.procs.db.conn({}) };
        const res = await ctx2.fns.session.loadAll({});
        expect(res.loaded).toBe(2);
        expect((ctx2.state as any).agent[a.id].messages).toEqual([{ role: "user", content: "hi", idx: 0 }]);
        expect((ctx2.state as any).agent[b.id].systemPrompt).toBe("sp");
        expect((ctx2.state as any).agent[idle.id]).toBeUndefined();
        expect((await ctx2.fns.session.load({ id: idle.id }))?.model).toBe("m3");
    });
});
