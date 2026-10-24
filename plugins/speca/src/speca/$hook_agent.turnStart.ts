// Speca's per-turn changes: the agent's workspace folder as it was before the turn (web/code/changes.ts). Kept in
// memory until agent.turnEnd compares it with the folder after.
import { snapshotStart } from "../../web/code/changes.ts";
import { codeDir } from "../../web/code/files.ts";

/** Snapshot the agent's workspace folder at the start of its turn.
 * @param opts.agentId Agent whose turn starts.
 * @param opts.turnId The turn's id.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Agent whose turn starts. */
    agentId: string;
    /** The turn's id. */
    turnId: string;
}): Promise<void> {
    const code = await codeDir(ctx, opts.agentId);
    if (!code) return;
    const snap = await snapshotStart(opts.agentId, code.h, code.dir);
    if (snap) (((ctx.state as any).specaSnaps ??= new Map()) as Map<string, unknown>).set(opts.turnId, snap);
}
