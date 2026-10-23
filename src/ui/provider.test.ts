import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

describe("ui provider role", () => {
    test("Hyper's own interface is declared and chosen by default", async () => {
        const ctx: any = await mkTestCtx();
        expect((await ctx.fns.ui.provider({})).name).toBe("hyper");
        expect(await ctx.fns.ui.url({ agentId: "ab" })).toBe("/a/ab");
        expect((await ctx.fns.ui.providers({})).find((p: any) => p.name === "hyper")?.chosen).toBe(true);
    });

    test("a chosen interface addresses home and agents; an unknown one falls back", async () => {
        const ctx: any = await mkTestCtx();
        ctx.state.ui.providers.other = { name: "other", title: "Other", home: "/other", agent: "/other/s/{id}", icon: "ph-x", description: "" };
        await ctx.fns.settings.set({ module: "ui", scopeType: "global", key: "provider", value: "other" });
        expect(await ctx.fns.ui.url({})).toBe("/other");
        expect(await ctx.fns.ui.url({ agentId: "a b" })).toBe("/other/s/a%20b");
        await ctx.fns.settings.set({ module: "ui", scopeType: "global", key: "provider", value: "missing" });
        expect((await ctx.fns.ui.provider({})).name).toBe("hyper");
    });
});
