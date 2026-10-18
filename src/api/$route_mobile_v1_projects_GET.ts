/** Lists active projects for native mobile navigation and agent creation. */
export default async function (ctx: Context, _session: Session | null, _opts: { req: Request; params: Record<string, string> }) {
    const projects = await ctx.fns.project.list({});
    return Response.json({ version: 1, projects });
}
