/** Every declared interface ($ui_<name>), with the one this person works in marked. */
export default async function (ctx: Context, _session: Session | null, _opts: {} = {}):
    Promise<Array<{ name: string; title: string; home: string; icon: string; description: string; chosen: boolean }>> {
    const chosen = (await ctx.fns.ui.provider({})).name;
    return Object.values((ctx.state as any).ui?.providers ?? {}).map((p: any) => ({
        name: p.name, title: p.title, home: p.home, icon: p.icon, description: p.description, chosen: p.name === chosen,
    })).sort((a, b) => (a.name === "hyper" ? -1 : b.name === "hyper" ? 1 : a.title.localeCompare(b.title)));
}
