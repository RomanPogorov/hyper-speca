import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

async function mkCtx() {
    const ctx: any = await mkTestCtx();
    const created: any[] = [];
    ctx.state.registry.project.create = async (_c: any, _s: any, o: any) => {
        if (o.slug === "taken") throw new Error("project.create: slug taken is taken");
        created.push(o);
        return { id: "c", ...o };
    };
    return { ctx, created };
}

const post = (ctx: any, fields: Record<string, string>) => {
    const body = new URLSearchParams(fields);
    return ctx.fns.procs.http.dispatch({ url: "/project/new", method: "POST", body });
};

describe("project new routes", () => {
    test("GET draws title, slug and folder fields", async () => {
        const { ctx } = await mkCtx();
        const res = await ctx.fns.procs.http.dispatch({ url: "/project/new" });
        expect(res.status).toBe(200);
        const html = await res.text();
        for (const name of ["title", "slug", "defaultDir"]) expect(html).toContain(`name="${name}"`);
        expect(html).toContain('action="/project/new"');
    });

    test("POST creates the project and opens the new-agent form inside it", async () => {
        const { ctx, created } = await mkCtx();
        const res = await post(ctx, { title: "Community", slug: "community", defaultDir: "/tmp" });
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/agent/new?project=c");
        expect(created).toEqual([{ title: "Community", slug: "community", defaultDir: "/tmp" }]);
    });

    test("POST with an error shows the form again with the message and the typed values", async () => {
        const { ctx, created } = await mkCtx();
        const res = await post(ctx, { title: "X", slug: "taken", defaultDir: "/tmp" });
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain("slug taken is taken");
        expect(html).toContain('value="taken"');
        expect(created).toEqual([]);
    });
});
