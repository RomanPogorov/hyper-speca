// "Saved", as in Speca (core/web/views/saved.ts): the person's own storage — messages saved from chats ("Save" under an
// answer), notes typed here, things the agent was asked to remember (speca.remember). Never shown to anyone else.
import { html, type Raw } from "./html.ts";
import * as k from "./ui/kit.ts";
import { rel } from "./fmt.ts";
import type { Ctx } from "./route.ts";

type Item = { id: string; kind: string; text: string; source: Record<string, any>; created_at: string };
const ICON: Record<string, string> = { message: "msg", snippet: "fileText", note: "pencil", link: "link", file: "paperclip" };

/** The first sentence (or line) is the title, the rest — clipped — the line under it. */
function split(text: string): [string, string] {
  const m = /^(.{12,120}?(?:[.!?:](?=\s)|\n))\s*([\s\S]*)$/.exec(text);
  if (m) return [m[1]!.trim(), m[2]!.replace(/\s+/g, " ").trim()];
  if (text.length <= 100) return [text, ""];
  const cut = text.lastIndexOf(" ", 90);
  return [`${text.slice(0, cut > 40 ? cut : 90)}…`, `…${text.slice(cut > 40 ? cut + 1 : 90).replace(/\s+/g, " ").trim()}`];
}

export async function savedHtml(c: Ctx): Promise<Raw> {
  const t = c.t;
  const q = (c.url.searchParams.get("q") ?? "").trim().slice(0, 200);
  let rows: Item[] = [];
  try {
    rows = await c.h.fns.procs.db.select({ sql: `SELECT id::text, kind, text, source, created_at FROM speca_saved WHERE user_id = ? ${q ? "AND text ILIKE ?" : ""} ORDER BY created_at DESC LIMIT 200`, params: q ? [c.user.id, `%${q}%`] : [c.user.id] }) as Item[];
  } catch { rows = []; }
  const item = (r: Item) => {
    const src = typeof r.source === "string" ? JSON.parse(r.source) : r.source ?? {};
    const [first, rest] = split(r.text.trim());
    return k.row({ icon: ICON[r.kind] ?? "bookmark", title: first, meta: rest ? (rest.length > 280 ? `${rest.slice(0, 280)}…` : rest) : undefined,
      meta2: `${src.title ? `${src.title} · ` : ""}${rel(new Date(Number(r.created_at)), t.locale)}`,
      actions: html`${src.session ? k.button({ icon: "arrowUR", variant: "ghost", size: "icon-xs", tooltip: t("saved.toSource"), side: "left", href: `/speca/s/${src.session}` }) : ""}${k.button({ icon: "trash", variant: "ghost", size: "icon-xs", tooltip: t("sv.remove"), side: "left", attrs: html`hx-post="/speca/saved/${r.id}/delete" hx-swap="none"` })}` });
  };
  return html`<div class="doc day" id="saved">
    ${k.pageHead({ title: t("term.saved"), sub: t("saved.sub") })}
    ${k.inlineForm({ attrs: html`hx-post="/speca/saved" hx-vals='{"kind":"note"}' hx-swap="none" data-reset`,
      input: k.input({ name: "text", placeholder: t("saved.notePh"), attrs: html`aria-label="${t("saved.notePh")}"` }),
      button: k.button({ label: t("saved.add"), icon: "plus", variant: "outline", type: "submit" }) })}
    ${rows.length > 8 || q ? k.filterBar(k.search({ name: "q", value: q, placeholder: t("art.search"), attrs: html`hx-get="/speca/saved" hx-trigger="input changed delay:250ms" hx-target="#saved" hx-select="#saved" hx-swap="outerHTML"` })) : ""}
    ${rows.length ? k.rows(rows.map(item), { divided: true }) : k.empty({ icon: "bookmark", text: q ? t("art.nothingFound") : t("saved.empty") })}
  </div>`;
}

/** Keep one item: a note typed on the page, or a chat's message (session + idx: its text and where it came from). */
export async function addSaved(c: Ctx): Promise<void> {
  const f = await c.form();
  let kind = f.kind === "message" ? "message" : "note";
  let text = String(f.text ?? "").trim();
  const source: Record<string, unknown> = {};
  if (kind === "message") {
    const sid = String(f.session ?? ""), idx = Number(f.idx);
    const [ev] = await c.h.fns.procs.db.select({ sql: `SELECT e.payload::jsonb->>'text' AS text, a.title FROM events e JOIN agents a ON a.id = e.agent_id WHERE e.agent_id = ? AND e.idx = ?`, params: [sid, idx] }) as Array<{ text: string | null; title: string | null }>;
    text = String(ev?.text ?? "").trim();
    Object.assign(source, { session: sid, idx, title: ev?.title || c.t("chat.newChat") });
  } else if (/^https?:\/\/\S+$/.test(text)) kind = "link";
  if (!text) throw new Error(c.t("saved.empty"));
  await c.h.fns.procs.db.run({ sql: "INSERT INTO speca_saved (user_id, kind, text, source, created_at) VALUES (?, ?, ?, ?::jsonb, ?)", params: [c.user.id, kind, text.slice(0, 20000), JSON.stringify(source), Date.now()] });
}

export async function removeSaved(c: Ctx, id: string): Promise<void> {
  await c.h.fns.procs.db.run({ sql: "DELETE FROM speca_saved WHERE id = ? AND user_id = ?", params: [Number(id), c.user.id] });
}
