/**
 * Send explicitly approved plain text to an allowlisted Telegram bot chat
 *
 * Requires confirm:true for the exact user-approved message and an exact numeric chat ID in botAllowedChatIds. No retries, formatting, attachments or MTProto access.
 * @param opts.chatId Exact numeric destination chat ID as a string.
 * @param opts.text Plain text to send, 1 to 4096 UTF-16 code units.
 * @param opts.confirm Must be true only after explicit approval of this send.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Exact numeric destination chat ID as a string. */
        chatId: string;
        /** Plain text to send, 1 to 4096 UTF-16 code units. */
        text: string;
        /** Must be true only after explicit approval of this send. */
        confirm: boolean;
    },
): Promise<Record<string, unknown>> {
    return await ctx.fns.telegram.botRequest({method:"sendMessage", chatId:opts.chatId, text:opts.text, confirm:opts.confirm});
}
