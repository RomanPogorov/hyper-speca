// What the canvas tab's own routes share (/speca/canvas/:tab/… and /speca/canvas/comments/:id/…): the person's tab
// with its chat, the comment as comments.js reads it, and the person's name as an author.
import { chatOfTab, type Tab } from "./canvas.ts";
import { withContext, type HSession } from "./hyper.ts";
import { say } from "./actions.ts";
import type { Ctx } from "./route.ts";

export const me = (c: Ctx) => `user:${c.user.id}`;

/** The tab of the address (:tab) and its chat — only a tab of the person's own chats. */
export async function ownTab(c: Ctx): Promise<{ tab: Tab; s: HSession }> {
  const id = Number(c.params.tab);
  const s = await chatOfTab(c, id);
  const tab = (await c.h.fns.canvas.tab({ itemId: id, agentId: s.id })) as Tab;
  return { tab, s };
}

/** The comment of the address (:id), with its tab and chat. */
export async function commentOf(c: Ctx): Promise<{ cm: any; tab: Tab; s: HSession }> {
  const id = Number(c.params.id);
  const rows = (await c.h.fns.procs.db.select({ sql: "SELECT item_id, parent_id FROM canvas_comments WHERE id = ?", params: [id] })) as any[];
  if (!rows[0]) throw new Error(c.t("common.notFound"));
  c.params.tab = String(rows[0].item_id);
  const { tab, s } = await ownTab(c);
  const root = Number(rows[0].parent_id ?? id);
  const cm = (await c.h.fns.canvas.comments({ itemId: tab.id, all: true })).find((x: any) => x.id === root);
  if (!cm) throw new Error(c.t("common.notFound"));
  return { cm, tab, s };
}

const nameOf = (c: Ctx, author: string) => (author === "agent" ? c.t("cm.agent") : author === me(c) || author === "user" ? c.user.name ?? c.t("cm.you") : author.replace(/^user:/, ""));
const mine = (c: Ctx, author: string) => author === me(c) || author === "user";

/** A comment the way Speca's comments.js reads it. */
export function cmJson(c: Ctx, cm: any) {
  return {
    id: String(cm.id), author: cm.author, name: nameOf(c, cm.author), mine: mine(c, cm.author),
    anchor: cm.target ?? { path: "", text: "", fx: 0, fy: 0 }, label: cm.quote ?? "", body: cm.text,
    replies: (cm.replies ?? []).map((r: any) => ({ author: r.author, name: nameOf(c, r.author), text: r.text, at: new Date(r.createdAt).toISOString(), mine: mine(c, r.author) })),
    sent: cm.sentAt != null, resolved: cm.status === "resolved", at: new Date(cm.createdAt).toISOString(),
  };
}

/** Comments to the agent as the person's message, Speca's way: one comment is its words; several are numbered under
 *  a line naming the tab. The tab and where each comment is pinned go along as context (chips in the log). */
export async function sendToAgent(c: Ctx, s: HSession, tab: Tab, ids: number[]): Promise<number> {
  if (!ids.length) return 0;
  const sent = await c.h.fns.canvas.sendComments({ itemId: tab.id, ids });
  if (!sent.ids.length) return 0;
  const all = (await c.h.fns.canvas.comments({ itemId: tab.id, all: true })) as any[];
  const cs = sent.ids.map((id: number) => all.find((x) => x.id === id)).filter(Boolean);
  const where = (x: any) => {
    const t = x.target ?? {};
    const label = x.quote ?? "";
    return `${label}${t.text && !label.includes(String(t.text).slice(0, 20)) ? ` — "${String(t.text).slice(0, 120)}"` : ""}`;
  };
  const text = cs.length === 1 ? cs[0].text : `${c.t("cm.batchIntro", { n: cs.length, title: tab.title })}\n\n${cs.map((x: any, i: number) => `${i + 1}. ${where(x) ? `${where(x)}: ` : ""}${x.text}`).join("\n")}`;
  const pin = (x: any) => { const t = x.target ?? {}; return t.file ? `${t.file}${t.tid != null ? `#${t.tid}` : ""}` : t.url ? `${t.url} ${t.path ?? ""}` : t.path ? `path ${t.path}` : "the whole tab"; };
  const lines = [`canvas tab «${tab.title}» (tab ${tab.id}, ${tab.kind})`, ...cs.map((x: any, i: number) => `${cs.length > 1 ? `${i + 1}. ` : ""}${where(x) || c.t("cm.page")} (comment ${x.id}, ${pin(x)})`)];
  await say(c, s, withContext(text, lines, "Act on these comments in the tab, then resolve each with canvas.resolveComment (a short reply if useful)."), `cm:${sent.ids.join(",")}`);
  return sent.ids.length;
}
