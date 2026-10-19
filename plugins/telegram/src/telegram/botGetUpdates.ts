/**
 * Poll one bounded batch of allowlisted Telegram bot updates
 *
 * Explicit offset and timeout, no worker or automatic acknowledgement. Only chat message updates are exposed. nextOffset covers hidden updates too; persist it only after handling the batch. One consumer per bot; polling conflicts with webhooks. No historical chat access.
 * @param opts.offset Nonnegative next update ID; advancing acknowledges earlier updates. @minimum 0
 * @param opts.timeout Long polling wait in seconds. @minimum 0 @maximum 30
 * @param opts.limit Maximum provider batch size before allowlist filtering. @default 100 @minimum 1 @maximum 100
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Nonnegative next update ID; advancing acknowledges earlier updates. @minimum 0 */
        offset: number;
        /** Long polling wait in seconds. @minimum 0 @maximum 30 */
        timeout: number;
        /** Maximum provider batch size before allowlist filtering. @default 100 @minimum 1 @maximum 100 */
        limit?: number;
    },
): Promise<Record<string, unknown>> {
    return await ctx.fns.telegram.botRequest({method:"getUpdates", offset:opts.offset, timeout:opts.timeout, limit:opts.limit});
}
