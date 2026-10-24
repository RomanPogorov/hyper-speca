/** A comment pinned to a canvas tab, with its answers. */
export type Comment = {
    /** Comment id. */
    id: number;
    /** Tab it is pinned to. */
    itemId: number;
    /** Who wrote it: "agent" or "user:<id>". */
    author: string;
    /** The comment. */
    text: string;
    /** Where in the tab it is pinned (what the kind understands); null — the whole tab. */
    target: Record<string, any> | null;
    /** The text or element it points at, as the person saw it. */
    quote: string | null;
    /** open or resolved. */
    status: "open" | "resolved";
    /** When it went to the agent, ms since epoch; null while it waits to be sent. */
    sentAt: number | null;
    /** When it was written, ms since epoch. */
    createdAt: number;
    /** When it was resolved, ms since epoch. */
    resolvedAt: number | null;
    /** Answers, oldest first. */
    replies: Array<{ id: number; author: string; text: string; createdAt: number }>;
};
