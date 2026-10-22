/**
 * Send an explicitly approved local image to an allowlisted Telegram bot chat
 *
 * Uploads one JPEG, PNG or WebP file (absolute path, up to 10 MB) as an inline photo with an optional plain caption. Requires confirm:true for the exact user-approved send and an exact numeric chat ID in botAllowedChatIds. No retries or MTProto access.
 * @param opts.chatId Exact numeric destination chat ID as a string.
 * @param opts.path Absolute local image path (JPEG, PNG or WebP, up to 10 MB).
 * @param opts.caption Optional plain caption, up to 1024 UTF-16 code units.
 * @param opts.confirm Must be true only after explicit approval of this send.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Exact numeric destination chat ID as a string. */
        chatId: string;
        /** Absolute local image path (JPEG, PNG or WebP, up to 10 MB). */
        path: string;
        /** Optional plain caption, up to 1024 UTF-16 code units. */
        caption?: string;
        /** Must be true only after explicit approval of this send. */
        confirm: boolean;
    },
): Promise<Record<string, unknown>> {
    return await ctx.fns.telegram.botRequest({method:"sendPhoto", chatId:opts.chatId, path:opts.path, caption:opts.caption, confirm:opts.confirm});
}
