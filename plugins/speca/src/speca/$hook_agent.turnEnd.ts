// Speca's per-turn changes: what the turn changed in the workspace folder, kept and shown in the chat as the
// "N files changed" card (a turn_changes event), opened in the Changes tab.
import { snapshotEnd, type Snap } from "../../web/code/changes.ts";

/** Compare the workspace folder with its snapshot from the turn's start; record and show what changed.
 * @param opts.agentId Agent whose turn ended.
 * @param opts.turnId The turn's id.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Agent whose turn ended. */
    agentId: string;
    /** The turn's id. */
    turnId: string;
}): Promise<void> {
    const snaps = (ctx.state as any).specaSnaps as Map<string, Snap> | undefined;
    const snap = snaps?.get(opts.turnId);
    if (!snap) return;
    snaps!.delete(opts.turnId);
    const ch = await snapshotEnd(ctx as any, opts.agentId, opts.turnId, snap);
    if (!ch) return;
    await ctx.fns.session.appendEvent({ id: opts.agentId, event: { type: "turn_changes", turnId: opts.turnId, files: ch.files.slice(0, 300), more: Math.max(0, ch.files.length - 300), added: ch.added, removed: ch.removed } });
}
