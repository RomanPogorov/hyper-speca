/**
 * Brings back a saved version of a canvas tab: its content becomes the draft again, as a new edit ("restored v2")
 * that can be undone — nothing is lost, the versions after it stay.
 * @param opts.itemId Tab to restore.
 * @param opts.v Version to bring back.
 * @param opts.author Who did it. @default "agent" from an agent, otherwise "user"
 * @param opts.agentId Agent whose canvas the tab must be on. @default any
 */
export default async function (ctx: Context, session: Session | null, opts: {
    /** Tab to restore. */
    itemId: number;
    /** Version to bring back. */
    v: number;
    /** Who did it. @default "agent" from an agent, otherwise "user" */
    author?: string;
    /** Agent whose canvas the tab must be on. @default any */
    agentId?: string;
}): Promise<types.canvas.Item> {
    const was = await ctx.fns.canvas.version({ itemId: opts.itemId, v: opts.v, agentId: opts.agentId });
    return ctx.fns.canvas.write({
        itemId: opts.itemId, args: was.args, state: was.state, title: was.title, note: `restored v${was.v}`,
        author: opts.author ?? (session?.kind === "agent" ? "agent" : "user"), turn: `restore:${Date.now()}`,
    });
}
