---
name: telegram-live
description: "Personal Telegram client over MTProto — find chats by title or username, list recent dialogs, read message history without marking it read, search messages globally or within a chat, find contacts, list folders and group participants, and perform guarded writes."
---

# Telegram

Read-only access to the user's personal Telegram account through GramJS/MTProto. The API credentials and authorized StringSession stay in 1Password vault `hyper`; they are never returned by plugin functions.

## Separate Bot API adapter

The `bot*` functions use a separate bot identity; existing personal MTProto APIs and credentials are unchanged.

- `telegram.botGetMe({})` — check configured bot identity.
- `telegram.botGetUpdates({ offset, timeout, limit? })` — one bounded poll (timeout 0–30 seconds, limit 1–100). Returns `{ updates, nextOffset }`. Requires an explicit nonnegative offset; **passing a higher offset acknowledges earlier updates at Telegram**. No automatic acknowledgement, offset storage or background worker: process the batch, persist the returned cursor, then explicitly use it on the next poll. The cursor advances over filtered updates too, so hidden events do not cause endless replay. Polling itself is not side-effect-free when you advance the offset.
- `telegram.botSendMessage({ chatId, text, confirm: true })` — explicitly approved plain text only, 1–4096 UTF-16 code units. No automatic retries (an uncertain network result may already have sent the message).
- `telegram.botSendPhoto({ chatId, path, caption?, confirm: true })` — one explicitly approved JPEG, PNG or WebP file (absolute path, up to 10 MB) with an optional plain caption; same allowlist and no retries.
- `telegram.botRequest` is the shared restricted transport; direct calls enforce the same guards.

### Configuration and portability

Declare instance values in `~/.hyper/settings/$settings_telegram.json` (or the `HYPER_SETTINGS` directory):

```json
{ "botTokenRef": "secret://telegram/bot-token", "botAllowedChatIds": ["-1001234567890"] }
```

This is a reference, **not a token**. Store the actual token separately in encrypted secret storage using the secret input workflow. Only `secret://namespace/name` references are accepted. Never put token values in settings, source, URLs in chat, or logs. The default reference is `secret://telegram/bot-token`; it does not create a secret. Both polling and sending fail closed with the default empty allowlist. IDs must be exact decimal strings, not usernames. Visibility is restricted to allowlisted message/edited-message/channel-post/edited-channel-post updates; other update types are discarded. Allowed messages may still contain forwards or replies from other chats.

For another Hyper instance, copy/install this official plugin version, regenerate runtime types, reload `telegram`, configure that instance's allowlist/reference and provision its own encrypted secret. No personal MTProto login, extra dependencies or deployment is required by the adapter. Never run two polling consumers against the same bot: coordinate a single owner and durable cursor. Existing webhooks conflict with polling; this adapter does not remove or configure them. It does not manage bot creation or BotFather.

Bot API is **not old chat history**: Telegram retains pending updates for at most 24 hours. A bot must be present in the chat and have permission to send; it cannot initiate an arbitrary private conversation. Group privacy mode normally limits what the bot receives to commands, replies and related service events. Changing privacy mode or bot permissions requires a separate explicit human action; this adapter does neither. A narrow allowlist filters locally after receipt, not Telegram's delivery policy. Requests have a timeout plus ten seconds network allowance, use a fixed HTTPS origin, refuse redirects, and return sanitized errors without provider descriptions or token URLs.


## Functions

- `telegram.me({})` — account metadata.
- `telegram.dialogs({ max? })` — recent chats, groups and channels.
- `telegram.findChat({ query, limit? })` — server-side search for direct chats, groups and channels by title, person name or username; own dialogs rank before global public results.
- `telegram.messages({ chat, max? })` — message history, oldest to newest; does **not** mark messages read.
- `telegram.search({ query, max? })` — global server-side message search.
- `telegram.searchChat({ chat, query, max? })` — search within one chat.
- `telegram.contacts({ query?, limit? })` — saved contacts or public/contact lookup.
- `telegram.folders({})` — dialog folders.
- `telegram.folder({ id })` — chats explicitly included in a folder.
- `telegram.participants({ chat, limit? })` — members of a group/channel.

- `telegram.reauth({ timeoutMs?, force? })` — idempotent login check. By default it returns `alreadyAuthorized: true` without opening a popup when the saved session is valid. If the session is invalid, it asks for the Telegram code and optional 2FA password in a browser popup and writes the resulting StringSession directly to 1Password vault `hyper`. Use `force: true` only for explicit credential rotation. Cancel terminates the entire login attempt.

The live MTProto client and session are internal and are never returned by plugin functions.

This version has no mark-read or general local Telegram mirror operations.

## News-channel producer

Telegram owns a durable broadcast-channel catalogue in `telegram.news_channels`; each channel has an independent JSON cursor (`maxMessageId`, `newestDate`). `telegram.news_posts` stores message content hashes and News links so edits are detected and unchanged posts are skipped.

- `telegram.newsDiscover({ folder?, add? })` — discover broadcast channels in a Telegram folder; excludes `Haiku` and `Just links` by default.
- `telegram.newsChannelAdd({ chat, title, folderId?, enabled? })` — add or update a channel.
- `telegram.newsChannels({ enabled? })` — list channels, cursors and post counts.
- `telegram.newsSyncChannel({ chat, max? })` — incrementally sync one channel through `news.put`.
- `telegram.newsSync({ max? })` — explicitly sync all enabled channels.

The producer never writes `news.items` directly. It ships no cron declaration; scheduling, if desired, belongs to the host. `Just links` remains disabled because link-following and article summarization require a separate producer.

## Write functions

These change the real Telegram account. Call only after an explicit user request and pass `confirm: true`:

- `telegram.send({ chat, text, parseMode?, confirm: true })` — send a text message.
- `telegram.sendFile({ chat, path, caption?, confirm: true })` — send a local file.
- `telegram.createFolder({ title, chats, confirm: true })` — create a dialog folder.
- `telegram.leave({ chat, confirm: true })` — leave a group/channel; destructive.

Without `confirm: true`, every write function refuses to act.

```ts
await ctx.fns.telegram.dialogs({ max: 20 });
await ctx.fns.telegram.search({ query: "Circleback", max: 10 });
await ctx.fns.telegram.findChat({ query: "ИИшница", limit: 10 });
await ctx.fns.telegram.messages({ chat: "-1001951583351", max: 30 });
```
