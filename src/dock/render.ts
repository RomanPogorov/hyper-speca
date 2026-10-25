/**
 * Renders the left sidebar (the Dock): the brand with search and menu (⌘/), new agent and the collapse
 * switch, the core pages, the person's top zone (pins and entries), recent chats, the bottom
 * zone and the signed-in person.
 *
 * Every `$dock_` entry is drawn in parallel with its own timeout; an entry that throws, times out or
 * returns nothing is simply left out, so one plugin cannot break or stall the page shell. Each entry is
 * wrapped in an element carrying `data-dock-id` for ordering and automation. The sidebar folds to a narrow
 * rail (`html[data-dock="rail"]`, kept in localStorage by /dock/dock.js and applied before first paint).
 * @param opts.timeoutMs Per-entry render budget in milliseconds. @default 1500 @minimum 50 @maximum 10000
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Per-entry render budget in milliseconds. @default 1500 @minimum 50 @maximum 10000 */
        timeoutMs?: number;
    },
): Promise<string> {
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: v });
    const budget = Math.max(50, Math.min(10_000, opts.timeoutMs ?? 1500));
    const { top, bottom, hidden } = await ctx.fns.dock.items({});
    const labels = Object.fromEntries([...top, ...bottom, ...hidden].map(x => [x.id, x.label ?? x.id]));
    const draw = async (item: types.dock.Registered): Promise<string> => {
        try {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const out = await Promise.race([
                Promise.resolve(item.render ? item.render(ctx, session) : { icon: item.icon ?? "ph-circle", label: item.label ?? item.id, href: item.href }),
                new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${budget}ms`)), budget); }),
            ]).finally(() => clearTimeout(timer));
            if (!out) return "";
            // A described button becomes a full labelled row; an entry's own markup stays a compact chip.
            const row = typeof out !== "string";
            const html = row ? await ctx.fns.dock.drawButton({ id: item.id, button: out }) : out;
            return html ? `<div class="dock-item ${row ? "dock-item-row" : "dock-item-chip"}" data-dock-id="${esc(item.id)}"${item.pinned ? ` data-dock-pinned="${item.pinned}"` : ""}>${html}</div>` : "";
        } catch (error: any) {
            ctx.fns.procs.log.warn({ event: "dock.render.failed", msg: `${item.id}: ${String(error?.message ?? error)}` });
            return "";
        }
    };
    const [topHtml, bottomHtml, me, favicon, chats] = await Promise.all([
        Promise.all(top.map(draw)),
        Promise.all(bottom.map(draw)),
        ctx.fns.auth.meBadge({}).catch(() => ""),
        ctx.fns.ui.faviconUrl({}).catch(() => ""),
        ctx.fns.session.list({}).catch(() => [] as Awaited<ReturnType<typeof ctx.fns.session.list>>),
    ]);
    const row = (href: string, icon: string, label: string, extra = "") =>
        `<a href="${esc(href)}" class="dock-row" title="${esc(label)}" aria-label="${esc(label)}"${extra}><span class="dock-ico"><i class="ph ${esc(icon)}" aria-hidden="true"></i></span><span class="dock-label">${esc(label)}</span></a>`;
    const pinnedAgents = new Set(top.filter(x => x.pinned === "agent").map(x => x.id.slice("agent:".length)));
    const recent = chats.filter(c => !c.parentId && !pinnedAgents.has(c.id)).slice(0, 12);
    const chatRows = recent.map(c => {
        const live = c.runState !== "idle";
        const title = c.title || c.id;
        return `<a href="/agent/${encodeURIComponent(c.id)}" class="dock-chat" title="${esc(title)}"><span class="dock-label">${esc(title)}</span>${live ? `<span class="dock-chat-live" aria-label="running"></span>` : ""}${c.unread ? `<span class="dock-chat-unread" aria-label="unread"></span>` : ""}</a>`;
    }).join("");
    const menu = ctx.fns.procs.ui.button({
        action: "open-global-menu", html: '<i class="ph ph-magnifying-glass" aria-hidden="true"></i>',
        appearance: "plain", title: "Search and menu — ⌘/", ariaLabel: "Open global menu", class: "dock-icon-btn",
        attrs: { onclick: "window.__navOpen?.()" },
    });
    const brand = favicon ? `<img src="${esc(favicon)}" alt="" class="dock-logo">` : `<span class="dock-logo"></span>`;
    return `<nav id="dock" aria-label="Sidebar" data-dock-hidden="${esc(JSON.stringify(hidden.map(x => x.id)))}" data-dock-labels="${esc(JSON.stringify(labels))}" class="dock-shell">
    <div class="dock-head">
      <a href="/" class="dock-brand" title="Hyper" aria-label="Hyper home">${brand}<span class="dock-label dock-wordmark">Hyper</span></a>
      <div class="dock-fixed dock-head-actions" data-dock-id="menu">${menu}<a href="/agent/new" class="dock-icon-btn" title="New agent" aria-label="New agent"><i class="ph ph-plus" aria-hidden="true"></i></a><button type="button" class="dock-icon-btn dock-collapse" data-dock-collapse title="Collapse sidebar" aria-label="Collapse sidebar" aria-pressed="false"><i class="ph ph-sidebar-simple" aria-hidden="true"></i></button></div>
    </div>
    <div class="dock-scroll" data-live-topic="agents">
      <div class="dock-nav">
        ${row("/", "ph-house", "Home")}
        ${row("/files", "ph-folder", "Files")}
        ${row("/llms", "ph-brain", "Models")}
        ${row("/plugins", "ph-puzzle-piece", "Plugins")}
        ${row("/settings", "ph-gear", "Settings")}
      </div>
      <div class="dock-section dock-section-top">
        <div class="dock-section-label"><span class="dock-label">Pinned</span></div>
        <div id="dock-top" class="dock-zone" data-dock-zone="top">${topHtml.join("")}</div>
      </div>
      ${recent.length ? `<div class="dock-section dock-section-chats">
        <div class="dock-section-label"><span class="dock-label">Chats</span><button type="button" class="dock-section-more" onclick="window.__navOpen?.()" title="All chats" aria-label="All chats"><i class="ph ph-dots-three" aria-hidden="true"></i></button></div>
        <div class="dock-chats">${chatRows}</div>
      </div>` : ""}
    </div>
    <div class="dock-foot">
      ${me ? `<div class="dock-fixed dock-me" data-dock-id="me">${me}</div>` : ""}
      <div id="dock-bottom" class="dock-zone" data-dock-zone="bottom">${bottomHtml.join("")}</div>
    </div>
    <script src="/dock/dock.js" defer></script>
  </nav>`;
}
