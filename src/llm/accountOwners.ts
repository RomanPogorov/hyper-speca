/**
 * Whose LLM accounts are whose: "provider/account" → user id. An account missing here is shared.
 *
 * Kept in memory (llm.setAccountOwner refreshes it): llm.resolveEndpoint reads it on every model call.
 */
export default async function (ctx: Context, _session: Session | null, _opts?: {}): Promise<Map<string, string>> {
    const root = ((ctx.state as any).llmOwners ??= {});
    if (root.map instanceof Map) return root.map;
    const rows = await ctx.fns.procs.db.select({ sql: "SELECT provider, account, owner_id FROM llm_account_owners" }).catch(() => []) as any[];
    root.map = new Map(rows.map((r) => [`${r.provider}/${r.account}`, String(r.owner_id)]));
    return root.map;
}
