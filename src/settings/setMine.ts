/**
 * Save the caller's own value of a declared setting (scope 'user'), used instead of the instance value whenever
 * this person (or their agent) reads it. A secret setting is encrypted under the person's name in local
 * secrets (secret://settings/<module>.<key>) and the setting keeps only that reference — the value never
 * lands in the settings table and nobody else's calls can read it.
 * @param opts.module Module that declares the setting.
 * @param opts.key Setting key.
 * @param opts.value New value (a string for secrets).
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Module that declares the setting. */
        module: string;
        /** Setting key. */
        key: string;
        /** New value (a string for secrets). */
        value: any;
    },
): Promise<{ ok: true; owner: string; secret: boolean }> {
    const owner = await ctx.fns.auth.ownerId({});
    if (!owner) throw new Error("settings.setMine: no signed-in person — use the instance settings");
    const descriptor = (ctx.state as any).settings?.registry?.get(`${opts.module}.${opts.key}`);
    const secret = descriptor?.type === "secret";
    let value = opts.value;
    if (secret) {
        const plain = String(value ?? "");
        if (!plain) throw new Error("settings.setMine: empty secret");
        await ctx.fns.secrets.putLocal({ namespace: "settings", name: `${opts.module}.${opts.key}`, value: plain, source: "settings", owner });
        value = `secret://settings/${opts.module}.${opts.key}`;
    }
    await ctx.fns.settings.set({ module: opts.module, scopeType: "user", scopeId: owner, key: opts.key, value, isSecret: secret });
    return { ok: true, owner, secret };
}
