/**
 * Call guarded Telegram Bot API identity, polling, plain text sending or photo sending
 *
 * Separate Bot API transport, not MTProto. sendPhoto uploads one local image (absolute path, JPEG/PNG/WebP, up to 10 MB) as multipart form data. Enforces chat allowlist and send confirmation even for direct calls. No retries, workers or automatic acknowledgement. Errors omit provider text and URLs.
 * @param opts.method Supported Bot API operation.
 * @param opts.offset Required nonnegative polling offset; higher offsets acknowledge earlier updates. @minimum 0
 * @param opts.timeout Required polling wait in seconds. @minimum 0 @maximum 30
 * @param opts.limit Maximum updates requested per poll. @default 100 @minimum 1 @maximum 100
 * @param opts.chatId Exact numeric allowlisted destination ID.
 * @param opts.text Plain text message, 1 to 4096 UTF-16 code units.
 * @param opts.path Absolute local image path for sendPhoto.
 * @param opts.caption Optional plain photo caption, up to 1024 UTF-16 code units.
 * @param opts.confirm Explicit approval for this exact send. @default false
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Supported Bot API operation. */
        method: "getMe" | "getUpdates" | "sendMessage" | "sendPhoto";
        /** Required nonnegative polling offset; higher offsets acknowledge earlier updates. @minimum 0 */
        offset?: number;
        /** Required polling wait in seconds. @minimum 0 @maximum 30 */
        timeout?: number;
        /** Maximum updates requested per poll. @default 100 @minimum 1 @maximum 100 */
        limit?: number;
        /** Exact numeric allowlisted destination ID. */
        chatId?: string;
        /** Plain text message, 1 to 4096 UTF-16 code units. */
        text?: string;
        /** Absolute local image path for sendPhoto (JPEG, PNG or WebP, up to 10 MB). */
        path?: string;
        /** Optional plain photo caption, up to 1024 UTF-16 code units. */
        caption?: string;
        /** Explicit approval for this exact send. @default false */
        confirm?: boolean;
    },
): Promise<Record<string, unknown>> {
    if (!["getMe", "getUpdates", "sendMessage", "sendPhoto"].includes(opts.method)) throw new Error("Unsupported Bot API method");
    const payload: Record<string, unknown> = {};
    let allowed: string[] = [];
    const sending = opts.method === "sendMessage" || opts.method === "sendPhoto";
    if (sending && opts.confirm !== true) throw new Error("Bot API send requires confirm: true");
    if (opts.method !== "getMe") {
     const value = await ctx.fns.settings.get({module:"telegram", key:"botAllowedChatIds", scopeType:"global"});
     if (!Array.isArray(value) || !value.every(v => typeof v === "string" && /^-?[1-9][0-9]*$/.test(v))) throw new Error("Invalid Bot API chat allowlist");
     allowed = value;
     if (!allowed.length) throw new Error("Bot API chat allowlist is empty");
    }
    if (opts.method === "getUpdates") {
     if (!Number.isSafeInteger(opts.offset) || opts.offset! < 0) throw new Error("Bot API polling requires an explicit nonnegative offset");
     if (!Number.isInteger(opts.timeout) || opts.timeout! < 0 || opts.timeout! > 30) throw new Error("Bot API polling requires an explicit timeout from 0 to 30");
     const limit = opts.limit ?? 100;
     if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Bot API limit must be from 1 to 100");
     Object.assign(payload, {offset:opts.offset, timeout:opts.timeout, limit, allowed_updates:["message","edited_message","channel_post","edited_channel_post"]});
    }
    if (opts.method === "sendMessage") {
     if (typeof opts.chatId !== "string" || !allowed.includes(opts.chatId)) throw new Error("Bot API chat is not allowed");
     if (typeof opts.text !== "string" || !opts.text.length || opts.text.length > 4096) throw new Error("Bot API text must contain 1 to 4096 characters");
     Object.assign(payload, {chat_id:opts.chatId, text:opts.text});
    }
    let form: FormData | null = null;
    if (opts.method === "sendPhoto") {
     if (typeof opts.chatId !== "string" || !allowed.includes(opts.chatId)) throw new Error("Bot API chat is not allowed");
     if (opts.caption !== undefined && (typeof opts.caption !== "string" || opts.caption.length > 1024)) throw new Error("Bot API caption must be a string of at most 1024 characters");
     if (typeof opts.path !== "string" || !opts.path.startsWith("/")) throw new Error("Bot API photo requires an absolute path");
     const type = ({jpg:"image/jpeg", jpeg:"image/jpeg", png:"image/png", webp:"image/webp"} as Record<string,string>)[opts.path.split(".").pop()!.toLowerCase()];
     if (!type) throw new Error("Bot API photo must be JPEG, PNG or WebP");
     const file = Bun.file(opts.path);
     if (!(await file.exists())) throw new Error("Bot API photo file not found");
     if (file.size < 1 || file.size > 10 * 1024 * 1024) throw new Error("Bot API photo must be 1 byte to 10 MB");
     form = new FormData();
     form.append("chat_id", opts.chatId);
     if (opts.caption) form.append("caption", opts.caption);
     form.append("photo", new Blob([await file.arrayBuffer()], {type}), opts.path.split("/").pop()!);
    }
    const ref = await ctx.fns.settings.get({module:"telegram", key:"botTokenRef", scopeType:"global"});
    if (typeof ref !== "string" || !/^secret:\/\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(ref)) throw new Error("Bot API requires a secret:// token reference");
    let token: string | null;
    try { token = await ctx.fns.secrets.get({ref}); } catch { throw new Error("Bot API credential unavailable"); }
    if (!token || !/^[0-9]+:[a-zA-Z0-9_-]+$/.test(token)) throw new Error("Bot API token is missing or invalid");
    let data: {ok?:boolean; result?:unknown};
    try {
     const response = await fetch("https://api.telegram.org/bot" + token + "/" + opts.method, {method:"POST", redirect:"error", ...(form ? {body:form} : {headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload)}), signal:AbortSignal.timeout(((opts.method === "getUpdates" ? opts.timeout! : 0) + (form ? 60 : 10)) * 1000)});
     if (!response.ok) throw new Error("HTTP failure");
     data = await response.json() as {ok?:boolean; result?:unknown};
     if (!data || data.ok !== true) throw new Error("Provider failure");
    } catch { throw new Error("Telegram Bot API request failed (provider, network or timeout); no retry performed"); }
    if (opts.method === "getUpdates") {
     if (!Array.isArray(data.result)) throw new Error("Invalid Bot API updates response");
     const updates: Record<string,unknown>[] = [];
     let nextOffset = opts.offset!;
     for (const item of data.result) {
      if (!item || !Number.isSafeInteger(item.update_id) || item.update_id < 0) continue;
      nextOffset = Math.max(nextOffset, item.update_id + 1);
      for (const kind of ["message","edited_message","channel_post","edited_channel_post"]) {
       const message = item[kind];
       if (message && Number.isSafeInteger(message.chat?.id) && allowed.includes(String(message.chat.id))) { updates.push({update_id:item.update_id, [kind]:message}); break; }
      }
     }
     return {updates, nextOffset};
    }
    if (!data.result || typeof data.result !== "object" || Array.isArray(data.result)) throw new Error("Invalid Bot API response");
    return data.result as Record<string, unknown>;
}
