// Versions, a draft and comments for canvas tabs. A tab's content (title, args, state) changes as a draft: every
// write is journaled (canvas_edits, the last 50) so it can be undone and redone; a version (canvas_versions) is saved
// only on purpose, with a name, and any version can be compared with another or brought back. canvas_items.version is
// the tab's last saved version and draft_edits counts the edits since it. Comments are pinned to a tab (and to a
// place in it), answered and resolved; the unsent ones go to the agent together. Additive.
export default {
    up: async (ctx: Context) => {
        await ctx.fns.procs.db.exec({ sql: `ALTER TABLE canvas_items ADD COLUMN IF NOT EXISTS draft_edits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE canvas_items ADD COLUMN IF NOT EXISTS focus JSONB;
CREATE TABLE IF NOT EXISTS canvas_versions (
    item_id BIGINT NOT NULL,
    v INTEGER NOT NULL,
    author TEXT NOT NULL,
    note TEXT,
    body JSONB NOT NULL,
    changes JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (item_id, v)
);
CREATE TABLE IF NOT EXISTS canvas_edits (
    item_id BIGINT NOT NULL,
    n INTEGER NOT NULL,
    author TEXT NOT NULL,
    note TEXT,
    body JSONB NOT NULL,
    turn TEXT,
    created_at BIGINT NOT NULL,
    undone_at BIGINT,
    dropped_at BIGINT,
    PRIMARY KEY (item_id, n)
);
CREATE TABLE IF NOT EXISTS canvas_comments (
    id BIGSERIAL PRIMARY KEY,
    item_id BIGINT NOT NULL,
    parent_id BIGINT,
    author TEXT NOT NULL,
    target JSONB,
    quote TEXT,
    text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    sent_at BIGINT,
    created_at BIGINT NOT NULL,
    resolved_at BIGINT
);
CREATE INDEX IF NOT EXISTS canvas_comments_item_idx ON canvas_comments (item_id, id);` });
    },
    down: async (ctx: Context) => {
        await ctx.fns.procs.db.exec({ sql: `DROP INDEX IF EXISTS canvas_comments_item_idx;
DROP TABLE IF EXISTS canvas_comments;
DROP TABLE IF EXISTS canvas_edits;
DROP TABLE IF EXISTS canvas_versions;
ALTER TABLE canvas_items DROP COLUMN IF EXISTS focus;
ALTER TABLE canvas_items DROP COLUMN IF EXISTS draft_edits` });
    },
};
