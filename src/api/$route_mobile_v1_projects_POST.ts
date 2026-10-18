/** Creates a project and optionally creates its local directory for the native mobile client. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    let body: any;
    try { body = await opts.req.json(); } catch { return Response.json({ error: "invalid_json", message: "Expected JSON" }, { status: 400 }); }
    try {
        const project = await ctx.fns.project.create({
            slug: typeof body.slug === "string" ? body.slug.trim() : "",
            title: typeof body.title === "string" ? body.title.trim() : "",
            defaultDir: typeof body.defaultDir === "string" ? body.defaultDir.trim() : "",
            defaultHost: typeof body.defaultHost === "string" ? body.defaultHost.trim() : "",
            createDir: body.createDir !== false,
        });
        return Response.json({ version: 1, project }, { status: 201 });
    } catch (error: any) {
        return Response.json({ error: "invalid_project", message: String(error?.message ?? error) }, { status: 400 });
    }
}
