// "Mine" for credentials, subscriptions and plugins (docs/multiuser/plan.md, phases 3–5).
//
// - local_secrets.owner_id: '' = shared by the whole instance (everything stored so far stays exactly
//   that, so nothing changes until somebody saves a personal one), otherwise the user it belongs to.
//   A read takes the caller's own row first, then the shared one (secrets.getLocal).
// - llm_account_owners: whose subscription/login an LLM account is. Files (~/.codex/auth.<acc>.json)
//   and oauth_credentials rows are not touched; an account with no row here is shared.
// - user_plugins: a person turning a plugin off for themselves (no row = on, as before).
//
// Additive, one transaction, lock_timeout like the users migration; ADD COLUMN with a constant default
// is catalog-only. The primary key of local_secrets grows by owner_id (small table).
const up_sql = [
    "SET LOCAL lock_timeout = '3s'",
    "ALTER TABLE local_secrets ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE local_secrets DROP CONSTRAINT IF EXISTS local_secrets_pkey",
    "ALTER TABLE local_secrets ADD PRIMARY KEY (namespace, name, owner_id)",
    `CREATE TABLE IF NOT EXISTS llm_account_owners (
        provider TEXT NOT NULL,
        account TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (provider, account)
    )`,
    `CREATE TABLE IF NOT EXISTS user_plugins (
        user_id TEXT NOT NULL,
        plugin TEXT NOT NULL,
        enabled BOOLEAN NOT NULL,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (user_id, plugin)
    )`,
];

const down_sql = [
    "SET LOCAL lock_timeout = '3s'",
    "DROP TABLE IF EXISTS user_plugins",
    "DROP TABLE IF EXISTS llm_account_owners",
    "DELETE FROM local_secrets WHERE owner_id <> ''",
    "ALTER TABLE local_secrets DROP CONSTRAINT IF EXISTS local_secrets_pkey",
    "ALTER TABLE local_secrets ADD PRIMARY KEY (namespace, name)",
    "ALTER TABLE local_secrets DROP COLUMN IF EXISTS owner_id",
];

async function inTransaction(ctx: Context, statements: string[]) {
    const pool: any = await ctx.fns.procs.db.conn();
    await pool.begin(async (tx: any) => {
        for (const statement of statements) await tx.unsafe(statement);
    });
}

export default {
    up: async (ctx: Context) => { await inTransaction(ctx, up_sql); },
    down: async (ctx: Context) => { await inTransaction(ctx, down_sql); },
};
