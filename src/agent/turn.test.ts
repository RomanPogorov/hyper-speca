import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

describe("agent turns", () => {
    test("a run opens after its message and closes with its outcome", async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "mock:test" });
        agent.scratchpad.mockLLM = { turns: [{ text: "hello back" }] };
        await ctx.fns.agent.run({ agent, userText: "hello" });
        const types = (await ctx.fns.session.getEvents({ id: agent.id })).map((e: any) => e.type);
        expect(types.slice(-4)).toEqual(["user", "turn_start", "assistant", "turn_end"]);
        const end = (await ctx.fns.session.getEvents({ id: agent.id })).at(-1);
        expect(end).toMatchObject({ type: "turn_end", status: "completed", error: null });
        expect(ctx.fns.agent.liveText({ id: agent.id })).toBeNull();
    });

    test("a failed run closes as failed and still throws", async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "mock:test" });
        ctx.state.registry.llm.stream = async () => { throw new Error("provider down"); };
        await expect(ctx.fns.agent.run({ agent, userText: "hi" })).rejects.toThrow("provider down");
        const end = (await ctx.fns.session.getEvents({ id: agent.id })).at(-1);
        expect(end).toMatchObject({ type: "turn_end", status: "failed", error: "provider down" });
    });

    test("streamed text is signalled on agent:<id>:stream and readable while it streams", async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "mock:test" });
        const seen: any[] = [];
        const off = ctx.fns.procs.events.subscribe({ topics: [`agent:${agent.id}:stream`], handler: (e: any) => seen.push({ e, live: ctx.fns.agent.liveText({ id: agent.id }) }) });
        ctx.state.agent ??= {};
        ctx.state.agent[agent.id] = agent;
        ctx.state.registry.llm.stream = async (_c: any, _s: any, o: any) => {
            o.onEvent({ type: "text_delta", delta: "par" });
            o.onEvent({ type: "text_delta", delta: "tial" });
            await new Promise(r => setTimeout(r, 200));
            return { text: "partial", usage: null, finishReason: "stop", toolCalls: [] };
        };
        await ctx.fns.agent.run({ agent, userText: "go" });
        off();
        expect(seen.length).toBeGreaterThanOrEqual(1);
        expect(seen[0].e).toMatchObject({ type: "stream", topic: `agent:${agent.id}:stream` });
        expect(seen[0].live?.text).toBe("partial");
    });
});
