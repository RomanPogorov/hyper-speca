// Core widget: New agent, the viewer's unread @mentions, pinned chats and recent chats — the first column of the menu.
export default {
    title: "Chats",
    icon: "ph-chats-circle",
    description: "New agent, unread mentions, pinned chats and the most recent chats",
    sizes: ["tall", "L", "M"],
    config: { limit: { type: "number", default: 50, description: "How many recent chats to list" } },
    async render(ctx: Context, _session: Session | null, opts: { size: types.nav.Size; config: Record<string, unknown> }): Promise<types.nav.WidgetOutput> {
        const limit = Math.max(1, Math.min(200, Number(opts.config.limit ?? 50) || 50));
        const [agents, mentions, pinnedIds] = await Promise.all([
            ctx.fns.nav.agents({ limit }).catch(() => [] as any[]),
            ctx.fns.mentions.list({ unreadOnly: true, limit: 10 }).catch(() => []),
            ctx.fns.auth.pinnedIds({}).catch(() => new Set<string>()),
        ]);
        const chatItems = await ctx.fns.nav.chatItems({ agents });
        const pinnedAgents = pinnedIds.size ? (await ctx.fns.nav.agents({ limit: 500 }).catch(() => [] as any[])).filter((a: any) => pinnedIds.has(String(a.id))) : [];
        const mentionsHtml = mentions.length ? await ctx.fns.mentions.rowsHtml({ items: mentions, navRow: true }) : "";
        return {
            items: [{ id: "chats:new", label: "New agent", href: "/agent/new", icon: "ph-plus", action: true }],
            sections: [
                ...(mentions.length ? [{ title: `Mentions · ${mentions.length}`, html: mentionsHtml, tone: "primary" as const }] : []),
                ...(pinnedAgents.length ? [{ title: "Pinned", items: await ctx.fns.nav.chatItems({ agents: pinnedAgents }), tone: "warning" as const }] : []),
                { title: "", items: chatItems },
            ],
        };
    },
} satisfies types.nav.Widget;
