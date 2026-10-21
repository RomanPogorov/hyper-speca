/**
 * Masks a job's secret values in text read from its output
 *
 * Resolves the secret references stored in the job spec and replaces every value with [REDACTED], longest first.
 * Used by jobs.poll and jobs.logs before output reaches an agent.
 * @param opts.spec The job's spec (only its secrets map is read).
 * @param opts.text Raw output text.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** The job's spec (only its secrets map is read). */
        spec: { secrets?: Record<string, string> };
        /** Raw output text. */
        text: string;
    },
): Promise<string> {
    let text = opts.text;
    const values: string[] = [];
    for (const ref of Object.values(opts.spec?.secrets ?? {})) {
        const v = await ctx.fns.secrets.get({ ref }).catch(() => null);
        if (v) values.push(v);
    }
    for (const v of [...new Set(values)].sort((a, b) => b.length - a.length)) text = text.replaceAll(v, "[REDACTED]");
    return text;
}
