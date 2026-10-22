/**
 * Lists every hyperd unit with its state, pid, current run and last exit
 *
 * Use to see what the local process supervisor runs: services (kept alive), tasks (one-shot, e.g. agent background jobs named after their job id) and terminal sessions.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<{ pid: number; seq: number; units: Array<{ name: string; kind: string; state: string; want: boolean; run: number; pid: number | null; owner?: string; startedAt?: number; readyAt?: number; restarts: number; lastExit?: { code: number | null; signal: string | null; at: number; reason: string }; error?: string; bytes: number; runDir: string | null }> }> {
    const st = await ctx.fns.hyperd.call({ path: "/status" });
    return { pid: st.pid, seq: st.seq, units: st.units.map(({ unit: _u, ...rest }: any) => rest) };
}
