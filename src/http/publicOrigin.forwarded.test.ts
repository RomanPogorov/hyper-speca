import { expect, test } from "bun:test";
import publicOrigin from "./publicOrigin";

function resolve(proto: string, host = "PUBLIC.example", peer: string | undefined = "127.0.0.1", throws = false) {
    const ctx = { state: { procs: { http: { server: { server: {
        requestIP: () => { if (throws) throw new Error("unavailable"); return peer ? { address: peer } : null; },
    } } } } } } as unknown as Context;
    const req = new Request("http://internal.example:3010/live", { headers: {
        "x-forwarded-proto": proto, "x-forwarded-host": host,
    } });
    return publicOrigin(ctx, null, { req });
}
const fallback = "http://internal.example:3010";
for (const peer of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    for (const [proto, expected] of [["wss", "https"], ["ws", "http"], ["https", "https"], ["http", "http"]]) {
        test(`${peer}: ${proto} resolves browser ${expected} origin`, async () => {
            expect(await resolve(proto!, "PUBLIC.example", peer)).toBe(`${expected}://public.example`);
        });
    }
}
test("non-loopback and missing peers ignore spoofed forwarding metadata", async () => {
    for (const peer of ["192.0.2.1", "10.0.0.1", "::ffff:192.0.2.1", ""]) {
        for (const proto of ["wss", "ws", "https", "http"]) expect(await resolve(proto, "evil.example", peer)).toBe(fallback);
    }
});
test("unavailable requestIP falls back to request origin", async () => {
    expect(await resolve("wss", "public.example", "127.0.0.1", true)).toBe(fallback);
    const ctx = { state: {} } as unknown as Context;
    expect(await publicOrigin(ctx, null, { req: new Request(fallback) })).toBe(fallback);
});
test("invalid and ambiguous forwarded schemes fall back", async () => {
    for (const proto of ["", "ftp", "javascript", "https,wss", "https, http"]) expect(await resolve(proto)).toBe(fallback);
});
test("invalid and ambiguous authorities fall back", async () => {
    for (const host of ["", "public.example@evil.example", "public.example/path", "public.example:99999", "public.example,evil.example", "public.example?x", "[::1]"]) {
        expect(await resolve("wss", host)).toBe(fallback);
    }
});
test("canonicalizes default ports and preserves non-default ports", async () => {
    expect(await resolve("wss", "PUBLIC.example:443")).toBe("https://public.example");
    expect(await resolve("ws", "PUBLIC.example:80")).toBe("http://public.example");
    expect(await resolve("wss", "PUBLIC.example:8443")).toBe("https://public.example:8443");
});
