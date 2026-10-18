import { describe, expect, test } from "bun:test";
import route from "./$route_mobile_v1_agents_GET";

describe("GET /api/mobile/v1/agents", () => {
    test("returns nav agents with visibility in a stable native-client envelope", async () => {
        let listOpts: any;
        const ctx: any = { fns: { nav: { agents: async (opts: any) => {
            listOpts = opts;
            return [{ id: "ab", title: "Agent", model: "test:model", runState: "idle", hasUnread: true, turns: 0, lastMessageAt: 10, workspaceDir: "/tmp", delegated: false, visibility: "nav" }];
        } }, project: { list: async () => [{ id: "p", title: "Mobile", slug: "mobile", defaultDir: "/tmp", defaultHost: "", createdBy: null, createdAt: 1, updatedAt: 1, archivedAt: null, agents: 1 }] }, mentions: { unreadByAgent: async () => ({ ab: 1 }) }, auth: { pinnedIds: async () => new Set<string>() }, procs: { db: { select: async () => [{ id: "ab", projectId: "p" }] } } } };
        const response = await route(ctx, null, { req: new Request("http://localhost/api/mobile/v1/agents"), params: {} });
        expect(response.status).toBe(200);
        expect(listOpts).toEqual({ limit: 50 });
        expect(await response.json()).toEqual({ version: 1, agents: [{ id: "ab", title: "Agent", model: "test:model", runState: "idle", unread: 1, mentions: 1, turns: 0, updatedAt: 10, workspaceDir: "/tmp", projectId: "p", projectTitle: "Mobile", pinned: false, delegated: false, visibility: "nav" }] });
    });
});
