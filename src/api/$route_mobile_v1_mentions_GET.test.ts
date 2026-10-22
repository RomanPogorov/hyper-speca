import { expect, test } from "bun:test";
import route from "./$route_mobile_v1_mentions_GET";

test("mobile mentions: unread by default with the badge total, authors resolved, agent authors named", async () => {
    let asked: any;
    const ctx: any = { fns: {
        mentions: {
            list: async (o: any) => { asked = o; return [
                { id: 7, agentId: "ab", agentTitle: "Отчёт", messageIdx: 12, from: "agent:ab", excerpt: "@nik глянь", createdAt: 5, readAt: null },
                { id: 6, agentId: "cd", agentTitle: null, messageIdx: 3, from: "anna", excerpt: "@nik привет", createdAt: 4, readAt: null },
            ]; },
            unreadCount: async () => 2,
        },
        auth: { author: async ({ userId }: any) => ({ id: userId, name: userId.toUpperCase(), initials: "X", hue: 1 }) },
    } };
    const res = await route(ctx, null, { req: new Request("http://localhost/api/mobile/v1/mentions?limit=500"), params: {} });
    expect(asked).toEqual({ unreadOnly: true, limit: 200 });
    const body = await res.json();
    expect(body).toMatchObject({ version: 1, unread: 2, mentions: [
        { id: 7, agentId: "ab", messageIdx: 12, fromAgent: "ab", author: { id: "agent:ab" } },
        { id: 6, agentId: "cd", fromAgent: null, author: { id: "anna", name: "ANNA" } },
    ] });
});

test("mobile mentions: unreadOnly=false lists read ones too", async () => {
    let asked: any;
    const ctx: any = { fns: { mentions: { list: async (o: any) => { asked = o; return []; }, unreadCount: async () => 0 }, auth: { author: async () => null } } };
    await route(ctx, null, { req: new Request("http://localhost/api/mobile/v1/mentions?unreadOnly=false"), params: {} });
    expect(asked).toEqual({ unreadOnly: false, limit: 50 });
});
