import { test, expect } from "bun:test";
import http1Allowed from "./http1Allowed";
import wsSelfCheck from "./wsSelfCheck";

const ctx = {} as Context;

test("HTTP/2 requests are always served; HTTP/1.1 only when allowed", () => {
    expect(http1Allowed(ctx, null, { httpVersion: "2.0", http1: false })).toBe(true);
    expect(http1Allowed(ctx, null, { httpVersion: "1.1", http1: true })).toBe(true);
    expect(http1Allowed(ctx, null, { httpVersion: "1.1", http1: false })).toBe(false);
});

test("wsSelfCheck reports a dead port as not ok instead of throwing", async () => {
    const r = await wsSelfCheck(ctx, null, { port: 1, timeoutMs: 2000 });
    expect(r.ok).toBe(false);
    expect(r.detail.length).toBeGreaterThan(0);
});
