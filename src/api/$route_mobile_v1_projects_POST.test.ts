import { expect, test } from "bun:test";
import route from "./$route_mobile_v1_projects_POST";

test("native API creates a project and its local directory by default", async () => {
    let values: any;
    const ctx: any = { fns: { project: { create: async (opts: any) => { values = opts; return { id: "p", ...opts }; } } } };
    const req = new Request("http://localhost/api/mobile/v1/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: "mobile", title: "Mobile", defaultDir: "/tmp/mobile" }) });
    const response = await route(ctx, null, { req, params: {} });
    expect(response.status).toBe(201);
    expect(values).toEqual({ slug: "mobile", title: "Mobile", defaultDir: "/tmp/mobile", defaultHost: "", createDir: true });
    expect(await response.json()).toMatchObject({ project: { id: "p", slug: "mobile" } });
});

test("native API returns project validation errors", async () => {
    const ctx: any = { fns: { project: { create: async () => { throw new Error("project.create: invalid"); } } } };
    const req = new Request("http://localhost/api/mobile/v1/projects", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const response = await route(ctx, null, { req, params: {} });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_project", message: "project.create: invalid" });
});
