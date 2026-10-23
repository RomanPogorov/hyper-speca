/**
 * The interface this person works in: their ui.provider setting (or the instance one), resolved to a
 * declared `$ui_<name>`. An unknown name falls back to Hyper's own interface and says so in the log.
 * @param opts.name Ask for this interface instead of the chosen one.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Interface name to resolve instead of the chosen one. */ name?: string } = {}):
    Promise<{ name: string; title: string; home: string; agent: string; icon: string; description: string }> {
    const providers: Record<string, any> = (ctx.state as any).ui?.providers ?? {};
    const fallback = providers.hyper ?? { name: "hyper", title: "Hyper", home: "/", agent: "/a/{id}", icon: "ph-terminal-window", description: "" };
    const wanted = opts.name ?? String(await ctx.fns.settings.get({ module: "ui", scopeType: "global", key: "provider" }).catch(() => "hyper") ?? "hyper");
    const found = providers[wanted];
    if (!found && wanted !== "hyper") ctx.fns.procs.log?.warn?.({ event: "ui.provider.unknown", msg: `interface "${wanted}" is not declared — using hyper` });
    return found ?? fallback;
}
