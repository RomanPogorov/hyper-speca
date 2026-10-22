import { afterEach, describe, expect, test } from "bun:test";
import botRequest from "./botRequest";
import botGetMe from "./botGetMe";
import botGetUpdates from "./botGetUpdates";
import botSendMessage from "./botSendMessage";
import botSendPhoto from "./botSendPhoto";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
function fixture(allowed: unknown = ["-123"], ref = "secret://telegram/bot-token") {
    const calls: { url: string; init?: RequestInit }[] = [];
    let secretReads = 0;
    const ctx: any = { fns: {
        settings: { get: async ({ key }: { key: string }) => key === "botTokenRef" ? ref : allowed },
        secrets: { get: async () => { secretReads++; return "123:FAKE_TEST_TOKEN"; } },
        telegram: {},
    } };
    ctx.fns.telegram.botRequest = (opts: any) => botRequest(ctx, null, opts);
    const reply = (result: unknown, status = 200) => {
        globalThis.fetch = (async (url: any, init: any) => {
            calls.push({ url: String(url), init });
            return new Response(JSON.stringify(status === 200 ? { ok: true, result } : { ok: false, description: "123:FAKE_TEST_TOKEN provider leak" }), { status });
        }) as typeof fetch;
    };
    reply({ id: 123, is_bot: true });
    return { ctx, calls, reply, secretReads: () => secretReads };
}
describe("Telegram isolated Bot API", () => {
    test("getMe uses secret reference and fixed HTTPS POST with redirect denial", async () => {
        const f = fixture();
        expect(await botGetMe(f.ctx, null, {})).toEqual({ id: 123, is_bot: true });
        expect(f.calls).toHaveLength(1);
        expect(f.calls[0].init?.method).toBe("POST");
        expect(f.calls[0].init?.redirect).toBe("error");
    });
    test("send requires exact confirmation and nonempty allowlist before secrets or HTTP", async () => {
        for (const [allowed, chatId, confirm] of [[[], "-123", true], [["-123"], "-456", true], [["-123"], "-123", false], [[123], "123", true]] as const) {
            const f = fixture(allowed);
            await expect(botSendMessage(f.ctx, null, { chatId, text: "hello", confirm })).rejects.toThrow();
            expect(f.calls).toHaveLength(0);
            expect(f.secretReads()).toBe(0);
        }
    });
    test("approved send is plain text with no retry or formatting", async () => {
        const f = fixture(); f.reply({ message_id: 7 });
        expect(await botSendMessage(f.ctx, null, { chatId: "-123", text: "<hello>", confirm: true })).toEqual({ message_id: 7 });
        expect(JSON.parse(String(f.calls[0].init?.body))).toEqual({ chat_id: "-123", text: "<hello>" });
        expect(f.calls).toHaveLength(1);
    });
    test("poll filters chats and update types, returns cursor without acknowledging", async () => {
        const f = fixture();
        f.reply([{ update_id: 10, message: { chat: { id: -123 }, text: "yes" } }, { update_id: 11, message: { chat: { id: -456 }, text: "hidden" } }, { update_id: 12, callback_query: { data: "hidden" } }]);
        const result = await botGetUpdates(f.ctx, null, { offset: 0, timeout: 30, limit: 10 });
        expect(result).toEqual({ updates: [{ update_id: 10, message: { chat: { id: -123 }, text: "yes" } }], nextOffset: 13 });
        expect(f.calls).toHaveLength(1);
        expect(JSON.parse(String(f.calls[0].init?.body))).toMatchObject({ offset: 0, timeout: 30, limit: 10 });
    });
    test("poll rejects implicit/negative offset, invalid timeout and limit without HTTP", async () => {
        const f = fixture();
        for (const opts of [{ timeout: 0 }, { offset: -1, timeout: 0 }, { offset: 0 }, { offset: 0, timeout: 31 }, { offset: 0, timeout: 0, limit: 101 }]) {
            await expect(botRequest(f.ctx, null, { method: "getUpdates", ...opts })).rejects.toThrow();
        }
        expect(f.calls).toHaveLength(0);
    });
    test("literal token configuration is rejected", async () => {
        const f = fixture([], "123:FAKE_TEST_TOKEN");
        await expect(botGetMe(f.ctx, null, {})).rejects.toThrow("secret://");
        expect(f.secretReads()).toBe(0);
    });
    test("provider, JSON, network and secret exceptions cannot leak credential text", async () => {
        const f = fixture();
        f.reply(null, 401);
        await expect(botGetMe(f.ctx, null, {})).rejects.toThrow("request failed");
        globalThis.fetch = (async () => { throw new Error("https://api.telegram.org/bot123:FAKE_TEST_TOKEN/getMe"); }) as typeof fetch;
        try { await botGetMe(f.ctx, null, {}); throw new Error("expected failure"); } catch (error) {
            expect(String(error)).not.toContain("FAKE_TEST_TOKEN"); expect(String(error)).not.toContain("https:");
        }
        globalThis.fetch = (async () => new Response("bad JSON")) as typeof fetch;
        await expect(botGetMe(f.ctx, null, {})).rejects.toThrow("request failed");
        f.ctx.fns.secrets.get = async () => { throw new Error("FAKE_TEST_TOKEN"); };
        await expect(botGetMe(f.ctx, null, {})).rejects.toThrow("credential unavailable");
    });
    test("empty allowlist forbids polling and oversized text is rejected", async () => {
        let f = fixture([]);
        await expect(botGetUpdates(f.ctx, null, { offset: 0, timeout: 0 })).rejects.toThrow("allowlist is empty");
        expect(f.calls).toHaveLength(0);
        f = fixture();
        await expect(botSendMessage(f.ctx, null, { chatId: "-123", text: "x".repeat(4097), confirm: true })).rejects.toThrow("4096");
        expect(f.calls).toHaveLength(0);
    });
    test("photo send is guarded and uploads multipart with caption", async () => {
        const png = "/tmp/hyper-bot-test-" + process.pid + ".png";
        await Bun.write(png, new Uint8Array([137, 80, 78, 71, 1, 2, 3]));
        for (const [allowed, chatId, confirm, path] of [[[], "-123", true, png], [["-123"], "-456", true, png], [["-123"], "-123", false, png], [["-123"], "-123", true, "rel.png"], [["-123"], "-123", true, "/tmp/x.gif"], [["-123"], "-123", true, "/tmp/missing-hyper.png"]] as const) {
            const f = fixture(allowed);
            await expect(botSendPhoto(f.ctx, null, { chatId, path, confirm })).rejects.toThrow();
            expect(f.calls).toHaveLength(0);
            expect(f.secretReads()).toBe(0);
        }
        const f = fixture(); f.reply({ message_id: 9 });
        expect(await botSendPhoto(f.ctx, null, { chatId: "-123", path: png, caption: "hi", confirm: true })).toEqual({ message_id: 9 });
        expect(f.calls).toHaveLength(1);
        expect(f.calls[0].url.endsWith("/sendPhoto")).toBe(true);
        const body = f.calls[0].init?.body as FormData;
        expect(body.get("chat_id")).toBe("-123");
        expect(body.get("caption")).toBe("hi");
        expect((body.get("photo") as File).size).toBe(7);
        await expect(botSendPhoto(f.ctx, null, { chatId: "-123", path: png, caption: "x".repeat(1025), confirm: true })).rejects.toThrow("1024");
    });
});
