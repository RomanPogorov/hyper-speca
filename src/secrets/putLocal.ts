/**
 * Encrypt and persist one local runtime secret
 *
 * Upserts a secret into encrypted Postgres local storage. Use for mutable OAuth tokens and bootstrap-cached static credentials.
 * Whose it is: `owner` when given ("" = shared by everybody); otherwise the entry the caller reads now is
 * updated in place (a refreshed personal token stays personal, a shared one stays shared), and a new entry
 * becomes the caller's own (auth.ownerId) — so what a person connects is theirs.
 * @param opts.namespace Logical owner such as google.
 * @param opts.name Stable secret key such as token:user@example.com.
 * @param opts.value Plain-text value to encrypt and persist.
 * @param opts.source Origin metadata such as op-bootstrap, oauth, or refresh. @default local
 * @param opts.owner Whose entry this is: a user id, or "" for shared by the whole instance.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Logical owner such as google. */
        namespace: string;
        /** Stable secret key such as token:user@example.com. */
        name: string;
        /** Plain-text value to encrypt and persist. */
        value: string;
        /** Origin metadata such as op-bootstrap, oauth, or refresh. @default local */
        source?: string;
        /** Whose entry this is: a user id, or "" for shared by the whole instance. */
        owner?: string;
    },
): Promise<{ ok: true; version: number; owner: string }> {
    const namespace = String(opts.namespace ?? "").trim();
    const name = String(opts.name ?? "").trim();
    if (!namespace || !name) throw new Error("local secret namespace and name are required");
    let owner: string;
    if (opts.owner !== undefined) owner = String(opts.owner);
    else {
        const me = await ctx.fns.auth.ownerId({});
        const existing = await ctx.fns.procs.db.select({
            sql: "SELECT owner_id FROM local_secrets WHERE namespace=? AND name=? AND owner_id IN (?, '') ORDER BY owner_id = '' LIMIT 1",
            params: [namespace, name, me],
        }) as any[];
        owner = existing[0] ? String(existing[0].owner_id) : me;
    }
    const envelope = await ctx.fns.secrets.encryptLocal({ namespace, name, value: opts.value });
    const now = Date.now();
    const result = await ctx.fns.procs.db.select({ sql: `INSERT INTO local_secrets(namespace,name,owner_id,value_enc,source,version,created_at,updated_at)
        VALUES (?,?,?,?,?,1,?,?) ON CONFLICT(namespace,name,owner_id) DO UPDATE SET value_enc=excluded.value_enc,
        source=excluded.source,version=local_secrets.version+1,updated_at=excluded.updated_at RETURNING version`, params: [namespace,name,owner,envelope,String(opts.source ?? "local"),now,now] }) as any[];
    // the in-memory cache of secrets.get is per owner; drop what this write made stale
    const cache: Map<string, string> | undefined = (ctx.state as any).secrets?.values;
    if (cache) for (const k of [...cache.keys()]) if (k.endsWith(`|${namespace}/${name}`)) cache.delete(k);
    return { ok: true, version: Number(result[0]?.version ?? 1), owner };
}
