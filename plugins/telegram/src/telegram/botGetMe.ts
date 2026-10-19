/**
 * Get the configured Telegram bot identity
 *
 * Checks Bot API identity using the configured secret reference; does not connect to the personal MTProto account.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<Record<string, unknown>> {
    return await ctx.fns.telegram.botRequest({method:"getMe"});
}
