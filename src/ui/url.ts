/**
 * Where to send this person: their interface's home, or one agent's page in it.
 * @param opts.agentId Agent whose page to address; omitted for the home page.
 * @param opts.provider Use this interface instead of the chosen one.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Agent whose page to address. */ agentId?: string;
        /** Interface to address instead of the chosen one. */ provider?: string } = {}): Promise<string> {
    const ui = await ctx.fns.ui.provider({ name: opts.provider });
    return opts.agentId ? ui.agent.replaceAll("{id}", encodeURIComponent(opts.agentId)) : ui.home;
}
