export default {
    type: "string",
    default: "secret://telegram/bot-token",
    title: "Bot API token reference",
    description: "Secret reference only (secret://namespace/name) for the separate Telegram Bot API identity. Store the token in encrypted secret storage, never in this setting. Does not affect MTProto.",
};
