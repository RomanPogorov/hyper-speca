/** Renders the Hyper home page: a greeting with today's state, a start line for a new agent, the setup
 * steps, what is running now and the recent agents. */
export default async function (ctx: Context, _session: Session | null, _opts?: {}): Promise<{ title: string; main: string }> {
    const esc = (value: any) => ctx.fns.procs.ui.escape({ text: String(value ?? "") });
    const [agents, accounts] = await Promise.all([
        ctx.fns.session.list({}),
        ctx.fns.llm.listAccounts({}).catch(() => [] as any[]),
    ]);
    const running = agents.filter((item: any) => item.runState !== "idle");
    const recent = agents.slice(0, 10);
    const connected = accounts.filter((item: any) => item.available !== false);
    const unread = agents.filter((item: any) => item.unread).length;
    const now = new Date();
    const hour = now.getHours();
    const greeting = hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    const day = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    const state = running.length ? `${running.length} running` : unread ? `${unread} with news` : agents.length ? "all quiet" : "let's set things up";
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
    const ago = (ms: number) => {
        const s = Math.max(0, (Date.now() - Number(ms || 0)) / 1000);
        return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`;
    };

    const step = (title: string, body: string, href: string, action: string, done: boolean) =>
        `<a href="${href}" class="group flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-base-200">
          <span class="flex size-7 flex-none items-center justify-center rounded-full ${done ? "bg-success/15 text-success" : "border border-ui-border-strong text-faint"}"><i class="ph ${done ? "ph-check" : "ph-circle-dashed"} text-sm" aria-hidden="true"></i></span>
          <span class="min-w-0 flex-1"><span class="block text-ui font-medium">${title}</span><span class="block truncate text-xs text-subtle">${body}</span></span>
          <span class="flex-none text-xs font-medium text-subtle group-hover:text-base-content">${action} <i class="ph ph-caret-right text-2xs" aria-hidden="true"></i></span>
        </a>`;
    const steps = [
        step("Connect an LLM", connected.length ? `${plural(connected.length, "account")} available` : "Connect Claude, Codex or another provider first.", "/llms", connected.length ? "Manage" : "Connect", connected.length > 0),
        step("Create an agent", agents.length ? `${plural(agents.length, "agent")} created` : "Choose a model and workspace to start.", "/agent/new", "New agent", agents.length > 0),
        step("Open workspace files", agents[0]?.workspaceDir ? esc(agents[0].workspaceDir) : "Browse the current project and documentation.", "/files", "Open Files", !!agents[0]?.workspaceDir),
    ];
    const setupDone = connected.length > 0 && agents.length > 0;

    const agentRow = (item: any) => {
        const live = item.runState !== "idle";
        return `<a href="/agent/${encodeURIComponent(item.id)}" class="group flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-base-200">
          <span class="flex size-7 flex-none items-center justify-center rounded-md border border-ui-border bg-base-100 text-subtle"><i class="ph ${live ? "ph-circle-notch animate-spin text-success" : "ph-sparkle"} text-sm" aria-hidden="true"></i></span>
          <span class="min-w-0 flex-1"><span class="block truncate text-ui font-medium">${esc(item.title || item.id)}</span><span class="block truncate text-xs text-faint">${live ? "Running" : "Last activity"} · ${esc(ago(item.updatedAt))}</span></span>
          ${item.unread ? `<span class="flex h-5 min-w-5 flex-none items-center justify-center rounded-full bg-primary px-1.5 text-3xs font-semibold text-primary-content">${esc(item.unread)}</span>` : ""}
          <span class="flex-none text-xs font-medium text-subtle opacity-0 group-hover:opacity-100">Open <i class="ph ph-caret-right text-2xs" aria-hidden="true"></i></span>
        </a>`;
    };
    const sectionTitle = (title: string, count?: number, extra = "") =>
        `<div class="flex items-center gap-2 px-3 pb-1"><h2 class="text-xs font-medium text-subtle">${title}</h2>${count ? `<span class="text-xs font-semibold text-base-content">${count}</span>` : ""}<span class="flex-1"></span>${extra}</div>`;

    const main = `<main class="min-h-full flex-1 overflow-y-auto bg-base-100">
  <div class="flex w-full max-w-3xl flex-col gap-6 px-6 pb-16 pt-7 lg:px-8">
    <header>
      <h1 class="text-title font-semibold tracking-tight">${greeting}</h1>
      <p class="mt-1 text-ui text-subtle">${esc(day)} · ${esc(state)}</p>
    </header>

    <a href="/agent/new" class="group flex items-center gap-3 rounded-xl border border-ui-border-strong bg-base-100 py-2 pl-4 pr-2 shadow-xs hover:border-ui-input">
      <span class="min-w-0 flex-1 truncate text-ui text-faint">Start a new agent — pick a model and a workspace, then give it the task…</span>
      <span class="flex size-8 flex-none items-center justify-center rounded-full bg-primary text-primary-content group-hover:opacity-90"><i class="ph ph-arrow-up text-sm" aria-hidden="true"></i></span>
    </a>

    ${running.length ? `<section>
      ${sectionTitle("Running now", running.length)}
      <div class="flex flex-col">${running.map(agentRow).join("")}</div>
    </section>` : ""}

    <section class="${setupDone ? "" : "rounded-xl border border-ui-border p-2 shadow-xs"}">
      ${setupDone ? sectionTitle("Workspace") : `<div class="flex items-center gap-2 px-3 pb-2 pt-1.5"><i class="ph ph-rocket-launch text-subtle" aria-hidden="true"></i><h2 class="text-ui font-semibold">Get started</h2></div>`}
      <div class="flex flex-col">${steps.join("")}</div>
    </section>

    <section>
      ${sectionTitle("Recent agents", 0, agents[0] ? `<a href="/agent/${encodeURIComponent(agents[0].id)}" class="text-xs font-medium text-subtle hover:text-base-content">Resume latest <i class="ph ph-caret-right text-2xs" aria-hidden="true"></i></a>` : "")}
      ${recent.length ? `<div class="flex flex-col">${recent.map(agentRow).join("")}</div>` : `<div class="flex flex-col items-center gap-2 px-3 py-10 text-center"><i class="ph ph-check text-3xl text-faint" aria-hidden="true"></i><p class="text-ui text-subtle">No agents yet. Connect a model, then create your first agent.</p></div>`}
    </section>
  </div>
</main>`;
    return { title: "Home", main };
}
