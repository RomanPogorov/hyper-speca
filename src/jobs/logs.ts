/**
 * Reads a background job's output, the whole log or a byte range, with secrets masked
 *
 * Use after a completion message whose tail was not enough, or to peek at a job that is still running. Large
 * outputs: read in ranges (offset/limit) or grep the log path on the job's host.
 * @param opts.id Job id.
 * @param opts.offset Byte offset to start at; negative counts from the end. @default -20000
 * @param opts.limit Maximum bytes to return. @default 20000
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Job id. */
        id: string;
        /** Byte offset to start at; negative counts from the end. @default -20000 */
        offset?: number;
        /** Maximum bytes to return. @default 20000 @minimum 1 @maximum 200000 */
        limit?: number;
    },
): Promise<{ id: string; status: string; bytes: number; offset: number; text: string; path: string; host: string | null }> {
    const job = await ctx.fns.jobs.get({ id: opts.id });
    if (job.runner !== "bash" && job.runner !== "attached") throw new Error(`jobs.logs: job ${job.id} (${job.runner}) has no output`);
    const limit = Math.max(1, Math.min(200_000, Math.floor(opts.limit ?? 20_000)));
    const offset = Math.floor(opts.offset ?? -20_000);
    const log = `$HOME/.hyper-jobs/${job.id}/out.log`;
    const r = await ctx.fns.jobs.sh({
        host: job.host,
        script: `[ -f "${log}" ] || { echo NOLOG; exit 0; }; size=$(wc -c < "${log}" | tr -d ' '); off=${offset}; [ $off -lt 0 ] && off=$((size + off)); [ $off -lt 0 ] && off=0; echo "SIZE=$size OFF=$off"; tail -c +$((off + 1)) "${log}" | head -c ${limit}`,
        timeout: 30,
    });
    if (r.unreachable) throw new Error(`jobs.logs: host ${job.host} unreachable`);
    if (r.stdout.startsWith("NOLOG")) return { id: job.id, status: job.status, bytes: 0, offset: 0, text: "", path: log, host: job.host };
    const nl = r.stdout.indexOf("\n");
    const head = r.stdout.slice(0, nl);
    const spec = { secrets: ((await ctx.fns.procs.db.select({ sql: "SELECT spec FROM jobs WHERE id = ?", params: [job.id] })) as any[])[0]?.spec?.secrets };
    return {
        id: job.id,
        status: job.status,
        bytes: Number(/SIZE=(\d+)/.exec(head)?.[1] ?? 0),
        offset: Number(/OFF=(\d+)/.exec(head)?.[1] ?? 0),
        text: await ctx.fns.jobs.redact({ spec, text: r.stdout.slice(nl + 1) }),
        path: `~/.hyper-jobs/${job.id}/out.log`,
        host: job.host,
    };
}
