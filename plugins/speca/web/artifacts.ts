// "Artifacts", as in Speca (core/web/views/artifacts.ts): everything chats produced, like a Telegram channel's shared
// media — filters (all, design, canvases, media, files, links), a scope (everything or one chat), search, grouped by
// month. Closed canvases stay here and open again in their chat at any version. On Hyper's data: canvas_items (tabs,
// closed ones too) with canvas_versions, attachments (files sent in messages), links found in messages, and the
// artboards of design canvases.
import { html, join, type Raw } from "./html.ts";
import * as k from "./ui/kit.ts";
import { tabIcon } from "./canvas.ts";
import { appShim } from "./hyper.ts";
import type { Ctx } from "./route.ts";

type Kind = "all" | "design" | "canvas" | "media" | "file" | "link";
type Art = { type: "canvas" | "media" | "file" | "link"; id: string; title: string; at: Date; chat: string; chatTitle: string; kind?: string; closed?: boolean; versions?: number; mime?: string; size?: number; url?: string; host?: string; who?: string };

const KINDS: Kind[] = ["all", "design", "canvas", "media", "file", "link"];
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const size = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const isMedia = (mime: string) => /^(image|video|audio)\//.test(mime);
const sel = async (c: Ctx, sql: string, params: unknown[]): Promise<any[]> => { try { return await c.h.fns.procs.db.select({ sql, params }) as any[]; } catch { return []; } };
const LINK_RE = `https?://[^\\s<>()"'\\]\\[\`]+`;

async function canvases(c: Ctx, session: string | null, q: string): Promise<Art[]> {
  const rows = await sel(c, `SELECT ci.id::text, ci.agent_id, ci.kind, ci.title, ci.closed_at, ci.updated_at, a.title AS chat_title,
      (SELECT count(*) FROM canvas_versions v WHERE v.item_id = ci.id)::int AS versions
    FROM canvas_items ci JOIN agents a ON a.id = ci.agent_id
    WHERE a.archived_at IS NULL ${session ? "AND ci.agent_id = ?" : ""} ${q ? "AND ci.title ILIKE ?" : ""}
    ORDER BY ci.updated_at DESC LIMIT 300`, [...(session ? [session] : []), ...(q ? [`%${q}%`] : [])]);
  return rows.map((r) => ({ type: "canvas", id: r.id, title: r.title || r.kind, at: new Date(Number(r.updated_at)), chat: r.agent_id, chatTitle: r.chat_title, kind: r.kind, closed: !!r.closed_at, versions: Number(r.versions) }));
}

async function files(c: Ctx, session: string | null, q: string): Promise<Art[]> {
  const rows = await sel(c, `SELECT f.id, f.agent_id, f.original_name, f.mime_type, f.size_bytes, f.created_at, a.title AS chat_title
    FROM attachments f JOIN agents a ON a.id = f.agent_id
    WHERE a.archived_at IS NULL ${session ? "AND f.agent_id = ?" : ""} ${q ? "AND f.original_name ILIKE ?" : ""}
    ORDER BY f.created_at DESC LIMIT 300`, [...(session ? [session] : []), ...(q ? [`%${q}%`] : [])]);
  return rows.map((r) => ({ type: isMedia(String(r.mime_type ?? "")) ? "media" : "file", id: r.id, title: r.original_name || r.id, at: new Date(Number(r.created_at)), chat: r.agent_id, chatTitle: r.chat_title, mime: String(r.mime_type ?? ""), size: Number(r.size_bytes ?? 0) }));
}

async function links(c: Ctx, session: string | null, q: string): Promise<Art[]> {
  const rows = await sel(c, `SELECT DISTINCT ON (m.url) m.url, e.agent_id, e.type, e.ts, a.title AS chat_title
    FROM events e JOIN agents a ON a.id = e.agent_id,
      LATERAL (SELECT (regexp_matches(e.payload::jsonb->>'text', '${LINK_RE}', 'g'))[1] AS url) m
    WHERE e.type IN ('user', 'assistant') AND a.archived_at IS NULL AND e.payload LIKE '%http%' ${session ? "AND e.agent_id = ?" : ""} ${q ? "AND m.url ILIKE ?" : ""}
    ORDER BY m.url, e.ts DESC LIMIT 300`, [...(session ? [session] : []), ...(q ? [`%${q}%`] : [])]);
  return rows.map((r) => {
    const url = String(r.url).replace(/[.,;:!?]+$/, "");
    let host = url;
    try { host = new URL(url).host; } catch { /* keep the url */ }
    return { type: "link" as const, id: url, title: host, url, host, at: new Date(Number(r.ts)), chat: r.agent_id, chatTitle: r.chat_title, who: r.type === "assistant" ? "agent" : "you" };
  }).sort((a, b) => b.at.getTime() - a.at.getTime());
}

type Board = { tab: string; chat: string; chatTitle: string; canvas: string; file: string; title: string; w: number; h: number; page: boolean; at: Date };
async function boards(c: Ctx, session: string | null, q: string): Promise<Board[]> {
  const rows = await sel(c, `SELECT ci.id::text, ci.agent_id, ci.title, ci.payload->'boards' AS boards, ci.payload->'order' AS ord, ci.updated_at, a.title AS chat_title
    FROM canvas_items ci JOIN agents a ON a.id = ci.agent_id WHERE ci.kind = 'speca.design' AND a.archived_at IS NULL ${session ? "AND ci.agent_id = ?" : ""}
    ORDER BY ci.updated_at DESC LIMIT 100`, session ? [session] : []);
  const out: Board[] = [];
  for (const r of rows) {
    const bs = (typeof r.boards === "string" ? JSON.parse(r.boards) : r.boards) ?? {};
    const order: string[] = (typeof r.ord === "string" ? JSON.parse(r.ord) : r.ord) ?? Object.keys(bs);
    for (const file of order) {
      const b = bs[file] ?? {};
      const title = String(b.title ?? file);
      if (q && !`${title} ${r.title}`.toLowerCase().includes(q.toLowerCase())) continue;
      out.push({ tab: r.id, chat: r.agent_id, chatTitle: r.chat_title, canvas: r.title, file, title, w: Number(b.w ?? 0), h: Number(b.h ?? 0), page: !!b.page, at: new Date(Number(r.updated_at)) });
    }
  }
  return out;
}

export async function artifactsHtml(c: Ctx): Promise<Raw> {
  const t = c.t;
  const sp = c.url.searchParams;
  const kind = (KINDS.includes(sp.get("kind") as Kind) ? sp.get("kind") : "all") as Kind;
  const session = sp.get("session") || null;
  const q = (sp.get("q") ?? "").trim().slice(0, 200);
  const ck = kind === "canvas" ? sp.get("ck") || null : null;
  const tz = c.user.tz ?? appShim.config.org.timezone;
  const loc = t.locale === "ru" ? "ru-RU" : "en-GB";
  // counts are of the whole scope; the list is the filter and the search
  const [cs, fs, ls, bs] = await Promise.all([canvases(c, session, ""), files(c, session, ""), links(c, session, ""), boards(c, session, "")]);
  const n = { canvas: cs.length, media: fs.filter((x) => x.type === "media").length, file: fs.filter((x) => x.type === "file").length, link: ls.length };
  const pick = async (): Promise<Art[]> => {
    const want = (ty: Art["type"]) => kind === "all" || kind === ty;
    const [c2, f2, l2] = await Promise.all([
      want("canvas") ? (q ? canvases(c, session, q) : cs) : [],
      want("media") || want("file") ? (q ? files(c, session, q) : fs) : [],
      want("link") ? (q ? links(c, session, q) : ls) : [],
    ]);
    return [...c2.filter((x) => !ck || x.kind === ck), ...f2.filter((x) => want(x.type)), ...l2].sort((a, b) => b.at.getTime() - a.at.getTime());
  };
  const items = kind === "design" ? [] : await pick();
  const chatTitle = session ? (cs[0]?.chatTitle ?? fs[0]?.chatTitle ?? (await sel(c, "SELECT title FROM agents WHERE id = ?", [session]))[0]?.title) || t("chat.newChat") : null;
  const qs = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const v: Record<string, string | null> = { kind: kind === "all" ? null : kind, ck, session, q: q || null, ...patch };
    for (const [key, x] of Object.entries(v)) if (x) p.set(key, x);
    const s = p.toString();
    return `/speca/artifacts${s ? `?${s}` : ""}`;
  };
  const month = (d: Date) => new Intl.DateTimeFormat(loc, { month: "long", year: "numeric", timeZone: tz }).format(d);
  const day = (d: Date) => new Intl.DateTimeFormat(loc, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz }).format(d);
  const where = (a: { chat: string; chatTitle: string }) => session ? "" : html`<a href="/speca/s/${a.chat}">${a.chatTitle || t("chat.newChat")}</a>`;
  const fileUrl = (a: Art) => `/attachments/${encodeURIComponent(a.chat)}/${encodeURIComponent(a.id)}`;
  const media = (list: Art[]) => k.tiles(list.map((a) => k.tile({ href: fileUrl(a), img: a.mime?.startsWith("image/") ? fileUrl(a) : undefined, icon: a.mime?.startsWith("video/") ? "play" : "headphones",
    title: a.title, meta: `${size(a.size ?? 0)} · ${day(a.at)}`, meta2: where(a) || undefined,
    actions: k.button({ icon: "download", variant: "ghost", size: "icon-xs", tooltip: t("files.download"), side: "top", href: `${fileUrl(a)}?download=1` }) })));
  const row = (a: Art): Raw => {
    if (a.type === "canvas") return k.row({ lead: tabIcon(c, a.kind ?? ""), title: html`<a href="/speca/s/${a.chat}?tab=${a.id}">${a.title}</a>`,
      meta: `${a.kind?.replace(/^speca\./, "")} · v${Math.max(1, a.versions ?? 0)} · ${day(a.at)}`, meta2: where(a) || undefined, right: a.closed ? k.pill(t("art.closed"), "muted") : undefined,
      actions: a.closed ? k.button({ label: t("art.reopen"), variant: "ghost", size: "sm", href: `/speca/s/${a.chat}?tab=${a.id}` }) : undefined, actionsAlways: !!a.closed });
    if (a.type === "link") return k.row({ icon: "link", title: html`<a href="${a.url}" target="_blank" rel="noopener noreferrer">${a.host}</a>`, meta: clip(a.url ?? "", 110),
      meta2: html`${a.who === "agent" ? t("search.agent") : t("coord.you")} · ${day(a.at)}${session ? "" : html` · ${where(a)}`}` });
    return k.row({ icon: "file", title: html`<a href="${fileUrl(a)}" target="_blank" rel="noopener">${a.title}</a>`, meta: `${a.mime} · ${size(a.size ?? 0)} · ${day(a.at)}`, meta2: where(a) || undefined,
      actions: k.button({ icon: "download", variant: "ghost", size: "icon-xs", tooltip: t("files.download"), side: "left", href: `${fileUrl(a)}?download=1` }) });
  };
  const chips: Array<[Kind, string, string, number]> = [["all", "layers", t("art.all"), n.canvas + n.media + n.file + n.link], ["design", "penTool", t("art.design"), bs.length], ["canvas", "appWindow", t("art.canvases"), n.canvas], ["media", "image", t("art.media"), n.media], ["file", "file", t("art.files"), n.file], ["link", "link", t("art.links"), n.link]];
  const search = k.search({ name: "q", value: q, placeholder: t("art.search"), attrs: html`hx-get="${qs({ q: null })}" hx-trigger="input changed delay:250ms" hx-target="#art-page" hx-select="#art-page" hx-swap="outerHTML" hx-include="this"` });
  const filters = k.filterBar(html`${join(chips.map(([key, icon, label, count]) => k.fchip({ label, icon, count, on: kind === key, href: qs({ kind: key === "all" ? null : key, ck: null }) })))}${search}`);
  // inside "Canvases": by kind (only the kinds there are)
  const kinds = [...cs.reduce((m, x) => m.set(x.kind!, (m.get(x.kind!) ?? 0) + 1), new Map<string, number>())];
  const kindBar = kind === "canvas" && kinds.length > 1 ? k.filterBar(html`${k.fchip({ label: t("art.allKinds"), count: n.canvas, on: !ck, href: qs({ ck: null }) })}${join(kinds.map(([kd, count]) => k.fchip({ label: kd.replace(/^speca\./, ""), count, on: ck === kd, href: qs({ ck: kd }) })))}`) : "";
  const head = k.pageHead({ title: chatTitle ? `${t("art.title")} · ${chatTitle}` : t("art.title"), sub: t("art.sub"),
    actions: chatTitle ? k.button({ label: t("art.everything"), icon: "x", variant: "ghost", size: "sm", href: qs({ session: null }) }) : undefined });
  if (kind === "design") {
    const shown = q ? await boards(c, session, q) : bs;
    const devIcon = (b: Board) => b.page || b.w >= 1000 ? "monitor" : b.w >= 600 ? "tablet" : "phone";
    const card = (b: Board) => k.tile({ href: `/speca/s/${b.chat}?tab=${b.tab}&focus=${encodeURIComponent(b.file)}`, newTab: false, icon: devIcon(b), title: b.title,
      meta: `${b.page ? t("design.page") : b.canvas} · ${b.w}×${b.h}`, meta2: session ? undefined : html`<a href="/speca/s/${b.chat}">${b.chatTitle || t("chat.newChat")}</a>` });
    return html`<div class="doc day art-page" id="art-page">${head}${filters}
      ${shown.length ? html`<div class="design-lib">${k.tiles(shown.map(card))}</div>` : k.empty({ icon: "penTool", text: q ? t("art.nothingFound") : t("design.empty") })}</div>`;
  }
  const groups = new Map<string, Art[]>();
  for (const a of items) groups.set(month(a.at), [...(groups.get(month(a.at)) ?? []), a]);
  return html`<div class="doc day art-page" id="art-page">
    ${head}${filters}${kindBar}
    ${!items.length ? k.empty({ icon: "layers", text: q ? t("art.nothingFound") : t("art.empty") }) : ""}
    ${join([...groups.entries()].map(([m, list]) => {
      const ms = list.filter((a) => a.type === "media"), rest = list.filter((a) => a.type !== "media");
      return k.pageSection({ title: m, body: html`${ms.length ? media(ms) : ""}${rest.length ? k.rows(rest.map(row), { divided: true }) : ""}` });
    }))}
  </div>`;
}
