import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

// A ctx whose calls run as the signed-in person `id` (ctx.session is what makeRequestCtx injects).
const as = (ctx: any, id: string) => { const c = Object.create(ctx); c.session = { user: { id } }; return c; };
const key = (n: number) => Buffer.alloc(32, n).toString("base64");

describe("personal credentials, settings and plugins", () => {
    test("a secret saved by one person is theirs; the shared one stays for the rest", async () => {
        const ctx: any = await mkTestCtx({ env: { HYPER_OAUTH_ENCRYPTION_KEY: key(21) } });
        await ctx.fns.secrets.putLocal({ namespace: "svc", name: "api", value: "shared", owner: "" });
        await as(ctx, "alice").fns.secrets.putLocal({ namespace: "svc", name: "api", value: "alice-own", owner: "alice" });
        expect(await as(ctx, "alice").fns.secrets.getLocal({ namespace: "svc", name: "api" })).toBe("alice-own");
        expect(await as(ctx, "bob").fns.secrets.getLocal({ namespace: "svc", name: "api" })).toBe("shared");
        // a new secret without owner becomes the caller's own; others never see it
        await as(ctx, "bob").fns.secrets.putLocal({ namespace: "svc", name: "bob-only", value: "b" });
        expect(await as(ctx, "alice").fns.secrets.getLocal({ namespace: "svc", name: "bob-only" })).toBeNull();
        expect(await as(ctx, "bob").fns.secrets.getLocal({ namespace: "svc", name: "bob-only" })).toBe("b");
    });

    test("secrets.get caches per person", async () => {
        const ctx: any = await mkTestCtx({ env: { HYPER_OAUTH_ENCRYPTION_KEY: key(22) } });
        await as(ctx, "alice").fns.secrets.set({ ref: "secret://svc/token", value: "A" });
        await as(ctx, "bob").fns.secrets.set({ ref: "secret://svc/token", value: "B" });
        expect(await as(ctx, "alice").fns.secrets.get({ ref: "secret://svc/token" })).toBe("A");
        expect(await as(ctx, "bob").fns.secrets.get({ ref: "secret://svc/token" })).toBe("B");
        expect(await as(ctx, "alice").fns.secrets.get({ ref: "secret://svc/token" })).toBe("A");
    });

    test("a personal setting wins for its owner only; a personal secret setting keeps only a reference", async () => {
        const ctx: any = await mkTestCtx({ env: { HYPER_OAUTH_ENCRYPTION_KEY: key(23) } });
        await ctx.fns.settings.set({ module: "demo", scopeType: "global", key: "color", value: "grey" });
        await as(ctx, "alice").fns.settings.setMine({ module: "demo", key: "color", value: "blue" });
        expect(await as(ctx, "alice").fns.settings.get({ module: "demo", scopeType: "global", key: "color" })).toBe("blue");
        expect(await as(ctx, "bob").fns.settings.get({ module: "demo", scopeType: "global", key: "color" })).toBe("grey");

        (ctx.state as any).settings ??= {};
        (ctx.state as any).settings.registry ??= new Map();
        (ctx.state as any).settings.registry.set("demo.apiKey", { type: "secret", title: "API key" });
        await as(ctx, "alice").fns.settings.setMine({ module: "demo", key: "apiKey", value: "sk-alice" });
        const [row] = await ctx.fns.procs.db.select({ sql: "SELECT value FROM settings WHERE module='demo' AND key='apiKey'", params: [] });
        expect(row.value).not.toContain("sk-alice");
        expect(await as(ctx, "alice").fns.secrets.resolveSetting({ module: "demo", key: "apiKey" })).toBe("sk-alice");
        expect(await as(ctx, "bob").fns.secrets.resolveSetting({ module: "demo", key: "apiKey" })).toBeNull();
        expect((await as(ctx, "alice").fns.settings.mine({})).find((s: any) => s.key === "apiKey")?.value).toBe("••••");

        await as(ctx, "alice").fns.settings.removeMine({ module: "demo", key: "color" });
        expect(await as(ctx, "alice").fns.settings.get({ module: "demo", scopeType: "global", key: "color" })).toBe("grey");
    });

    test("a plugin turned off by one person is gone only from their list", async () => {
        const ctx: any = await mkTestCtx({});
        const name = (ctx.fns.plugins.list({}) as any[])[0]?.name;
        if (!name) return; // no plugins mounted in this test ctx
        await as(ctx, "alice").fns.plugins.setEnabled({ plugin: name, enabled: false });
        expect(await as(ctx, "alice").fns.plugins.offFor({})).toEqual([name]);
        expect(await as(ctx, "bob").fns.plugins.offFor({})).toEqual([]);
        await as(ctx, "alice").fns.plugins.setEnabled({ plugin: name, enabled: true });
        expect(await as(ctx, "alice").fns.plugins.offFor({})).toEqual([]);
    });
});
