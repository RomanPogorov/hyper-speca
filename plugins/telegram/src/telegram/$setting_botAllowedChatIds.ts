export default {
    type: "json",
    default: [],
    title: "Bot API allowed chat IDs",
    description: "Array of exact numeric Telegram chat IDs as strings. Restricts Bot API sends and visible updates; empty means no chats allowed. Group IDs are usually negative. Does not affect MTProto.",
};
