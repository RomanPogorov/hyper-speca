/**
 * Drop the caller's own value of a setting: their calls use the instance value again. A personal secret is
 * deleted from local secrets as well.
 * @param opts.module Module that declares the setting.
 * @param opts.key Setting key.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Module that declares the setting. */
        module: string;
        /** Setting key. */
        key: string;
    },
): Promise<{ ok: true }> {
    const owner = await ctx.fns.auth.ownerId({});
    if (!owner) return { ok: true };
    await ctx.fns.settings.remove({ module: opts.module, scopeType: "user", scopeId: owner, key: opts.key });
    const name = `${opts.module}.${opts.key}`;
    await ctx.fns.procs.db.run({ sql: "DELETE FROM local_secrets WHERE namespace = 'settings' AND name = ? AND owner_id = ?", params: [name, owner] });
    const cache: Map<string, string> | undefined = (ctx.state as any).secrets?.values;
    if (cache) cache.delete(`${owner}|settings/${name}`);
    return { ok: true };
}
