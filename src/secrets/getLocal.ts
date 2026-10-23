/**
 * Read and decrypt one locally persisted runtime secret
 *
 * Returns a decrypted local secret or null without contacting external providers. Use before any 1Password bootstrap fallback.
 * Personal first: the caller's own entry (auth.ownerId), then the shared one. Another person's entry is never read.
 * @param opts.namespace Logical secret namespace.
 * @param opts.name Stable secret key.
 * @param opts.owner Read exactly this owner's entry ("" = the shared one) instead of "mine, else shared".
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Logical secret namespace. */
        namespace: string;
        /** Stable secret key. */
        name: string;
        /** Read exactly this owner's entry ("" = the shared one) instead of "mine, else shared". */
        owner?: string;
    },
): Promise<string | null> {
    const namespace = String(opts.namespace ?? "").trim();
    const name = String(opts.name ?? "").trim();
    const exact = opts.owner !== undefined;
    const me = exact ? String(opts.owner) : await ctx.fns.auth.ownerId({});
    const rows = await ctx.fns.procs.db.select({
        sql: exact
            ? "SELECT value_enc FROM local_secrets WHERE namespace=? AND name=? AND owner_id=?"
            : "SELECT value_enc FROM local_secrets WHERE namespace=? AND name=? AND owner_id IN (?, '') ORDER BY owner_id = '' LIMIT 1",
        params: [namespace, name, me],
    }) as any[];
    if (!rows[0]) return null;
    return ctx.fns.secrets.decryptLocal({ namespace, name, envelope: String(rows[0].value_enc) });
}
