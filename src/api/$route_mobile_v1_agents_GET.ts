/** Lists active Hyper agents for the native mobile client. */
export default async function (ctx: Context, _session: Session | null, _opts: { req: Request; params: Record<string, string> }) {
    const agents = await ctx.fns.nav.agents({ limit: 50 });
    const [pins, mentions, projects] = await Promise.all([
        ctx.fns.auth.pinnedIds({}),
        ctx.fns.mentions.unreadByAgent({}),
        ctx.fns.project.list({}),
    ]);
    const ids = agents.map(agent => agent.id);
    const projectRows = ids.length ? await ctx.fns.procs.db.select({
        sql: `SELECT id, project_id AS "projectId" FROM agents WHERE id IN (${ids.map(() => "?").join(", ")})`,
        params: ids,
    }) as any[] : [];
    const projectIdByAgent = new Map(projectRows.map(row => [String(row.id), row.projectId == null ? null : String(row.projectId)]));
    const projectById = new Map(projects.map(project => [project.id, project]));
    return Response.json({
        version: 1,
        agents: agents.map(agent => ({
            id: agent.id,
            title: agent.title,
            model: agent.model,
            runState: agent.runState,
            unread: agent.hasUnread ? 1 : 0,
            mentions: Number(mentions[agent.id] ?? 0),
            turns: agent.turns ?? 0,
            updatedAt: agent.lastMessageAt ?? 0,
            workspaceDir: agent.workspaceDir,
            projectId: projectIdByAgent.get(agent.id) ?? null,
            projectTitle: projectIdByAgent.get(agent.id) ? projectById.get(projectIdByAgent.get(agent.id)!)?.title ?? null : null,
            pinned: pins.has(agent.id),
            delegated: agent.delegated,
            visibility: agent.visibility,
        })),
    });
}
