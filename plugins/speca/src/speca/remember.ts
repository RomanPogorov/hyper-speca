/**
 * Keep something in the person's Saved (their own storage, never shown to anyone else): a decision, a fact, a link, a
 * snippet they asked to remember. It appears on their Saved page and is found later with speca.recall.
 * @param opts.text What to keep, in full.
 * @param opts.kind note, snippet or link. @default note
 * @param opts.title Where it came from (a chat's title), shown under it.
 * @param opts.session The chat it came from, for the link back.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
  /** What to keep. */ text: string;
  /** note, snippet or link. @default note */ kind?: "note" | "snippet" | "link";
  /** Where it came from. */ title?: string;
  /** The chat it came from. */ session?: string;
}): Promise<{ id: string }> {
  const text = String(opts.text ?? "").trim();
  if (!text) throw new Error("speca.remember: pass text");
  const kind = ["note", "snippet", "link"].includes(String(opts.kind)) ? String(opts.kind) : /^https?:\/\/\S+$/.test(text) ? "link" : "note";
  const source = { ...(opts.title ? { title: String(opts.title).slice(0, 200) } : {}), ...(opts.session ? { session: String(opts.session) } : {}) };
  const user = String(await Promise.resolve((ctx.fns as any).auth?.ownerId?.({})).catch(() => "") || "local");
  const [row] = await ctx.fns.procs.db.select({ sql: "INSERT INTO speca_saved (user_id, kind, text, source, created_at) VALUES (?, ?, ?, ?::jsonb, ?) RETURNING id::text", params: [user, kind, text.slice(0, 20000), JSON.stringify(source), Date.now()] }) as Array<{ id: string }>;
  return { id: String(row?.id ?? "") };
}
