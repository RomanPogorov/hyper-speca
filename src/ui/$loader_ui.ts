// Owns `$ui_<name>.json` — an interface for people: the pages a person lands on
// (home) and the page of one agent (agent, with {id}). Hyper's own interface is
// one of them (ui/$ui_hyper.json, the default); a plugin can bring another, and
// each person picks theirs with the setting ui.provider. The engine — agents,
// events, tools, canvases, settings — is the same under every interface.
//
//   { "title": "Speca", "home": "/speca", "agent": "/speca/s/{id}", "icon": "ph-sparkle" }
/** Collects `$ui_<name>.json` interface declarations into ctx.state.ui.providers. */
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Entries to load. */ entries: any[] }): Promise<void> {
    const st = ((ctx.state as any).ui ??= {});
    const providers: Record<string, any> = { ...(st.providers ?? {}) };
    for (const entry of opts.entries) {
        const raw = JSON.parse(await Bun.file(entry.abs).text());
        const local = (v: unknown) => typeof v === "string" && v.startsWith("/") && !v.startsWith("//");
        if (!local(raw.home) || !local(raw.agent) || !String(raw.agent).includes("{id}")) {
            throw new Error(`${entry.rel}: $ui declaration requires { home, agent } as local URLs, agent with {id}`);
        }
        if (providers[entry.name] && providers[entry.name].rel !== entry.rel) {
            // One name, one interface: a second claim is an error, never a silent override.
            throw new Error(`${entry.rel}: interface "${entry.name}" is already declared by ${providers[entry.name].rel}`);
        }
        providers[entry.name] = {
            name: entry.name,
            title: String(raw.title ?? entry.name),
            home: String(raw.home),
            agent: String(raw.agent),
            icon: String(raw.icon ?? "ph-browser"),
            description: String(raw.description ?? ""),
            rel: entry.rel,
        };
    }
    st.providers = providers;
}
