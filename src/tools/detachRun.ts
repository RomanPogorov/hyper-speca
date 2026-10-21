/**
 * Moves a running tool call to the background: the call returns now, the work goes on as a job
 *
 * Use when the person no longer wants to wait for a long command (the "to background" button). Only calls whose
 * tool marked them detachable (local bash) can be moved; the tool returns a result naming the job, and the agent
 * gets the usual job message when the process ends.
 * @param opts.id Execution id of the running call, from tools.runs.
 */
export default function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Execution id of the running call, from tools.runs. */
        id: string;
    },
): { detached: boolean; reason?: string } {
    const registry: Map<string, types.tools.ToolRun> = ((ctx.state as any).toolRuns ??= new Map());
    const run = registry.get(opts.id);
    if (!run) return { detached: false, reason: "not running" };
    if (!run.detachable || !run.detach) return { detached: false, reason: `${run.name} cannot be moved to the background` };
    try { run.detach.abort("detach"); } catch { /* already detaching */ }
    if (run.agentId) ctx.fns.procs.events.refresh({ topic: `agent:${run.agentId}`, reason: "tool-run-detach" });
    return { detached: true };
}
