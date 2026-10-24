/**
 * Find things in the person's Saved (what they saved from chats, their notes, what they asked to remember): every word
 * of the query must match; newest first.
 * @param opts.query Words to look for; empty — the latest items.
 * @param opts.limit How many to return. @default 20
 */
export default async function (ctx: Context, _session: Session | null, opts: {
  /** Words to look for. */ query?: string;
  /** How many. @default 20 */ limit?: number;
}): Promise<Array<{ id: string; kind: string; text: string; source: unknown; at: string }>> {
  const words = String(opts.query ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 8);
  const user = String(await Promise.resolve((ctx.fns as any).auth?.ownerId?.({})).catch(() => "") || "local");
  const rows = await ctx.fns.procs.db.select({
    sql: `SELECT id::text, kind, text, source, created_at FROM speca_saved WHERE user_id = ? ${words.map(() => "AND text ILIKE ?").join(" ")} ORDER BY created_at DESC LIMIT ?`,
    params: [user, ...words.map((w) => `%${w}%`), Math.min(100, Math.max(1, Number(opts.limit ?? 20)))],
  }) as any[];
  return rows.map((r) => ({ id: r.id, kind: r.kind, text: r.text, source: r.source, at: new Date(Number(r.created_at)).toISOString() }));
}
