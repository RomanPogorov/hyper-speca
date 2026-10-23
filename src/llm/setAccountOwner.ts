/**
 * Makes an LLM account (a subscription login or key slot) somebody's own, or shared again.
 *
 * A personal account is used for that person's agents when their model names no account, and is refused
 * to everybody else's agents (llm.resolveEndpoint). Shared (owner "") = anybody's agents may use it.
 * @param opts.provider Provider as in model refs and llm.listAccounts, e.g. "codex", "claude-code".
 * @param opts.account Account slot, e.g. "default", "personal".
 * @param opts.owner User id, or "" to make it shared. Defaults to the caller (auth.ownerId).
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Provider as in model refs and llm.listAccounts, e.g. "codex", "claude-code". */
        provider: string;
        /** Account slot, e.g. "default", "personal". */
        account: string;
        /** User id, or "" to make it shared. Defaults to the caller (auth.ownerId). */
        owner?: string;
    },
): Promise<{ provider: string; account: string; owner: string }> {
    const provider = String(opts.provider ?? "").trim();
    const account = String(opts.account ?? "").trim() || "default";
    if (!provider) throw new Error("provider is required");
    const owner = opts.owner !== undefined ? String(opts.owner) : await ctx.fns.auth.ownerId({});
    if (owner) {
        await ctx.fns.procs.db.run({
            sql: `INSERT INTO llm_account_owners (provider, account, owner_id, updated_at) VALUES (?, ?, ?, ?)
                  ON CONFLICT (provider, account) DO UPDATE SET owner_id = excluded.owner_id, updated_at = excluded.updated_at`,
            params: [provider, account, owner, Date.now()],
        });
    } else {
        await ctx.fns.procs.db.run({ sql: "DELETE FROM llm_account_owners WHERE provider = ? AND account = ?", params: [provider, account] });
    }
    delete (ctx.state as any).llmOwners?.map;
    ctx.fns.procs.events.refresh({ topic: "llm-accounts", reason: "owner-changed" });
    return { provider, account, owner };
}
