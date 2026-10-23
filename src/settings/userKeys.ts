/**
 * The settings somebody has a personal value of ("module.key"), loaded once and kept in memory.
 *
 * settings.get consults the person's own value only for these keys, so the per-user layer costs no query
 * for the hundreds of settings nobody personalised. settings.set adds to it; settings.remove leaves it
 * (a stale key costs one extra lookup, never a wrong value).
 */
export default async function (ctx: Context, _session: Session | null, _opts?: {}): Promise<Set<string>> {
    const root = ((ctx.state as any).settings ??= {});
    if (root.userKeys instanceof Set) return root.userKeys;
    const rows = await ctx.fns.procs.db.select({ sql: "SELECT DISTINCT module, key FROM settings WHERE scope_type = 'user'" }).catch(() => []) as any[];
    root.userKeys = new Set(rows.map((r) => `${r.module}.${r.key}`));
    return root.userKeys;
}
