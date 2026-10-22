import { expect, test } from "bun:test";
import route from "./$route_mobile_v1_mentions_$id_read_POST";

test("mobile mention read marks exactly that mention and returns the new unread total", async () => {
    const marked: any[] = [];
    const ctx: any = { fns: { mentions: { markRead: async (o: any) => { marked.push(o); return { read: 1 }; }, unreadCount: async () => 3 } } };
    const res = await route(ctx, null, { req: new Request("http://localhost/api/mobile/v1/mentions/7/read", { method: "POST" }), params: { id: "7" } });
    expect(await res.json()).toEqual({ version: 1, ok: true, id: 7, read: 1, unread: 3 });
    expect(marked).toEqual([{ id: 7 }]);
    const bad = await route(ctx, null, { req: new Request("http://localhost/api/mobile/v1/mentions/x/read", { method: "POST" }), params: { id: "x" } });
    expect(bad.status).toBe(400);
});
