import { expect, test } from "bun:test";
import route from "./$route_mobile_v1_projects_GET";

test("native API lists active projects", async () => {
    const projects = [{ id: "p", slug: "mobile", title: "Mobile", defaultDir: "/tmp/mobile", defaultHost: "", createdBy: null, createdAt: 1, updatedAt: 2, archivedAt: null, agents: 3 }];
    const ctx: any = { fns: { project: { list: async (opts: any) => { expect(opts).toEqual({}); return projects; } } } };
    const response = await route(ctx, null, { req: new Request("http://localhost/api/mobile/v1/projects"), params: {} });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version: 1, projects });
});
