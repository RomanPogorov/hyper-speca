// agent.watch creates a `watch` job
// (jobs table, runner watch); the worker's jobs.poll leases due rows and jobs.tickSchedule
// evaluates them. These tests drive that path the way the worker does.
import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

async function setup(predicate?: (opts: any) => any) {
    const ctx: any = await mkTestCtx();
    const agent = await ctx.fns.agent.start({ model: "mock:test" });
    if (predicate) ctx.state.registry.agent.watchPredicate = async (_c: any, _s: any, o: any) => predicate(o);
    return { ctx, agent };
}

// jobs.poll finishes its pass before returning; settle stays as a guard.
async function settle(ctx: any, agentId: string, triggerId: string) {
    for (let i = 0; i < 100; i++) {
        const row = (await ctx.fns.ui.automationRows({ id: agentId, status: "all" })).find((t: any) => t.id === triggerId);
        if (row && row.status !== "checking") return row;
        await Bun.sleep(10);
    }
    throw new Error(`trigger ${triggerId} still checking`);
}

describe("agent.watch", () => {
    test("wakes with the prompt once the predicate is ready and records the result", async () => {
        const { ctx, agent } = await setup(() => ({ ready: true, result: { ok: 42 } }));
        const watch = await ctx.fns.agent.watch({ id: agent.id, predicate: "file.exists", opts: { path: "x" }, prompt: "wait for x", everyMs: 5000, timeoutMs: 60_000 });
        expect(watch.id).toStartWith("tr_");
        expect((await ctx.fns.jobs.poll({ now: watch.nextAt })).checked).toEqual([watch.id]);
        const row = await settle(ctx, agent.id, watch.id);
        expect(row.status).toBe("completed");
        expect(row.lastOutcome).toBe("fired");
        expect(row.lastResult).toEqual({ ok: 42 });
        const msg = (await ctx.fns.session.getMessages({ id: agent.id })).at(-1);
        expect(msg.content).toBe("wait for x");
        expect(msg.message_type).toBe("trigger");
    });

    test("reschedules a false predicate and then times out", async () => {
        const { ctx, agent } = await setup(() => ({ ready: false }));
        const watch = await ctx.fns.agent.watch({ id: agent.id, predicate: "http.ok", opts: { url: "https://example.test" }, prompt: "wait", everyMs: 5000, timeoutMs: 5000 });
        await ctx.fns.jobs.poll({ now: watch.nextAt });
        let row = await settle(ctx, agent.id, watch.id);
        expect(row.status).toBe("active");
        expect(row.lastOutcome).toBe("waiting");
        expect(Number(row.nextAt)).toBe(watch.nextAt + 5000);
        await ctx.fns.jobs.poll({ now: watch.timeoutAt + 1 });
        row = await settle(ctx, agent.id, watch.id);
        expect(row.status).toBe("timed_out");
        // no onTimeoutPrompt in the legacy API: nothing is delivered
        expect((await ctx.fns.session.getMessages({ id: agent.id })).some((m: any) => m.content === "wait")).toBe(false);
    });

    test("cancel prevents delivery", async () => {
        const { ctx, agent } = await setup(() => ({ ready: true }));
        const watch = await ctx.fns.agent.watch({ id: agent.id, predicate: "file.exists", opts: { path: "x" }, prompt: "never" });
        expect((await ctx.fns.jobs.cancel({ id: watch.id })).status).toBe("cancelled");
        expect((await ctx.fns.jobs.poll({ now: watch.nextAt })).checked).toEqual([]);
        expect((await ctx.fns.session.getMessages({ id: agent.id })).some((m: any) => m.content === "never")).toBe(false);
    });

    test("atomic claim prevents duplicate delivery", async () => {
        const { ctx, agent } = await setup(() => ({ ready: true, result: { once: true } }));
        const watch = await ctx.fns.agent.watch({ id: agent.id, predicate: "file.exists", opts: { path: "x" }, prompt: "once", everyMs: 5000, timeoutMs: 60_000 });
        const claims = await Promise.all([
            ctx.fns.jobs.poll({ now: watch.nextAt }),
            ctx.fns.jobs.poll({ now: watch.nextAt }),
        ]);
        expect(claims.flatMap((c: any) => c.checked)).toEqual([watch.id]);
        await settle(ctx, agent.id, watch.id);
        const events = (await ctx.fns.session.getEvents({ id: agent.id })).filter((e: any) => e.type === "wake_up" && e.triggerId === watch.id);
        expect(events).toHaveLength(1);
    });

    test("a large result is kept as a valid preview in the run history", async () => {
        const { ctx, agent } = await setup(() => ({ ready: true, result: { blob: "x".repeat(30_000) } }));
        const watch = await ctx.fns.agent.watch({ id: agent.id, predicate: "file.exists", opts: { path: "x" }, prompt: "large", everyMs: 5000, timeoutMs: 60_000 });
        await ctx.fns.jobs.poll({ now: watch.nextAt });
        const row = await settle(ctx, agent.id, watch.id);
        expect(row.status).toBe("completed");
        expect(row.lastOutcome).toBe("fired");   // the run record was written, not lost to invalid json
        expect(row.lastResult.truncated).toBe(true);
        expect(row.lastResult.originalChars).toBeGreaterThan(30_000);
        expect(JSON.stringify(row.lastResult).length).toBeLessThan(17_000);
    });

    test("runtime.fn invokes any registered function with args", async () => {
        const { ctx, agent } = await setup();
        ctx.state.registry.tmp ??= {};
        ctx.state.registry.tmp.probe = async (_ctx: any, _session: any, opts: any) => ({ ready: opts.value === 42, result: { value: opts.value } });
        const watch = await ctx.fns.agent.watch({ id: agent.id, predicate: "runtime.fn", opts: { name: "tmp.probe", args: { value: 42 } }, prompt: "runtime ready", everyMs: 5000, timeoutMs: 60_000 });
        await ctx.fns.jobs.poll({ now: watch.nextAt });
        const row = await settle(ctx, agent.id, watch.id);
        expect(row.status).toBe("completed");
        expect(row.lastResult).toEqual({ value: 42 });
    });
});

