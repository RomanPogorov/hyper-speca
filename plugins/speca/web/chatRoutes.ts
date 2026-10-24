// The chat's fragments (log pages, folded work, a call, the head, the dock, the canvas) — what route files return.
import { html } from "./html.ts";
import type { Ctx } from "./route.ts";
import { getSession, loadEvents, type HSession } from "./hyper.ts";
import { chatCtx, chatOf, FIRST_TURNS, OLDER_TURNS, markSeen, shownInLog, turnsFrom } from "./pages.ts";
import { callBody, chatHead, emptyChat, logHtml, logTail, olderMark, queueDock, toolsList, workHtml } from "./views/chat.ts";
import { fold, type Turn } from "./fold.ts";
import type { ChatCtx } from "./views/chat.ts";

export async function head(c: Ctx) {
  const s = await getSession(c.h, c.user.id, c.params.id!);
  return s ? chatHead(await chatCtx(c, s)) : "";
}

export async function log(c: Ctx) {
  const s = await getSession(c.h, c.user.id, c.params.id!);
  if (!s) return "";
  const cx = await chatCtx(c, s);
  const all = await loadEvents(c.h, s);
  // an older page: the turns before `before`, with the mark for the ones before them
  const before = c.url.searchParams.get("before");
  if (before) {
    const to = Math.max(0, Number(before) || 0), from = turnsFrom(all, OLDER_TURNS, { before: to });
    return html`${olderMark(c.t, s.id, from)}${logHtml(cx, all.filter((e) => e.idx >= from && e.idx < to)).html}`;
  }
  // the tail: from the turn that holds `after` on (it may still be going); all of it for an empty log
  const after = Number(c.url.searchParams.get("after") ?? -1);
  const from = after < 0 ? turnsFrom(all, FIRST_TURNS) : turnsFrom(all, 1, { holding: after + 1 });
  const events = all.filter((e) => e.idx >= from);
  const max = events.length ? events[events.length - 1]!.idx : -1;
  await markSeen(c, s, max);
  const any = events.some(shownInLog);
  if (after < 0 || !any) return html`${any ? html`${olderMark(c.t, s.id, from)}${logHtml(cx, events).html}` : emptyChat(cx)}<div id="log-mark" hx-swap-oob="outerHTML" data-after="${max}" hidden></div>`;
  return logTail(cx, events, after);
}

/** A folded turn's work, and one call's arguments and result — drawn when the person opens them. */
async function turnOf(c: Ctx): Promise<{ cx: ChatCtx; turn: Turn } | null> {
  const s = await getSession(c.h, c.user.id, c.params.id!);
  if (!s) return null;
  const from = Number(c.url.searchParams.get("from")), to = Number(c.url.searchParams.get("to"));
  if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) return null;
  const events = (await loadEvents(c.h, s)).filter((e) => e.idx >= from && e.idx <= to);
  const turn = fold(events).find((x) => x.startIdx === from) ?? null;
  return turn ? { cx: await chatCtx(c, s), turn } : null;
}

export async function work(c: Ctx) {
  const x = await turnOf(c);
  return x ? workHtml(x.cx, x.turn) : "";
}

export async function tools(c: Ctx) {
  const x = await turnOf(c);
  const g = x?.turn.items.find((i): i is Extract<typeof i, { k: "tools" }> => i.k === "tools" && i.id === c.url.searchParams.get("group"));
  return x && g ? toolsList(x.cx, g, x.turn) : "";
}

export async function call(c: Ctx) {
  const x = await turnOf(c);
  const id = c.url.searchParams.get("id");
  const cl = x?.turn.items.flatMap((i) => (i.k === "tools" ? i.calls : [])).find((v) => v.id === id);
  return x && cl ? callBody(x.cx, cl) : "";
}

export async function qdock(c: Ctx) {
  const s: HSession = await chatOf(c);
  return queueDock(await chatCtx(c, s), []);
}
