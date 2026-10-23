/**
 * The caller's own setting values: which declared keys they set for themselves. Secrets are reported as set,
 * never with their value.
 */
export default async function (ctx: Context, _session: Session | null, _opts?: {}): Promise<Array<{ module: string; key: string; value: any; secret: boolean; updatedAt: number }>> {
    const owner = await ctx.fns.auth.ownerId({});
    if (!owner) return [];
    const rows = await ctx.fns.procs.db.select({
        sql: "SELECT module, key, value, is_secret, updated_at FROM settings WHERE scope_type = 'user' AND scope_id = ? ORDER BY module, key",
        params: [owner],
    }) as any[];
    return rows.map((row: any) => {
        const secret = Boolean(Number(row.is_secret));
        return { module: row.module, key: row.key, value: secret ? "••••" : JSON.parse(row.value), secret, updatedAt: Number(row.updated_at) };
    });
}
