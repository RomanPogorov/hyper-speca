import { expect, test } from "bun:test";
import route from "./$route_mobile_v1_new-agent-options_GET";

test("native new-agent options include projects", async () => {
    const project = { id: "p", slug: "mobile", title: "Mobile", defaultDir: "/tmp/mobile", defaultHost: "", createdBy: null, createdAt: 1, updatedAt: 2, archivedAt: null, agents: 2 };
    const ctx: any = { fns: {
        llm: { listModels: async () => ({ test: ["test:model"] }) },
        settings: { modelDefault: async () => "test:model" },
        session: { list: async () => [{ workspaceDir: "/tmp/other" }] },
        project: { list: async () => [project] },
    } };
    const response = await route(ctx, null, { req: new Request("http://localhost/api/mobile/v1/new-agent-options"), params: {} });
    expect(await response.json()).toEqual({ version: 1, defaultModel: "test:model", models: [{ provider: "test", model: "test:model" }], workspaces: ["/tmp/other"], projects: [project] });
});
