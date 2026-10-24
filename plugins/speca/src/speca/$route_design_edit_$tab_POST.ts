// POST /speca/design/edit/:tab — the person's edit of an artboard by address, a splice of its source that goes to the
// canvas draft as their edit:
// - one or several elements (`tids`): style from the panel, text in place, delete, duplicate, move, drag to a place,
//   wrap, an attribute (a link's target, an image);
// - one copy of a repeat: its text edits its data value (`data`), delete / duplicate / move edit its data item (`item`);
// - components: make one from an element, or detach an instance back into markup;
// - hand-written copies: make them one repeat (data + a template).
// `v` is the version of the file the person was looking at: if it changed since, nothing is written (409).
import { route } from "../../web/route.ts";
import { me } from "../../web/canvasApi.ts";
import { designTab, jsonBody, bad, isInt, isNum, isStr, oneOf, isChanges } from "../../web/design/routes.ts";
import { FILE, version, placeNew, sheetOf, type DesignState } from "../../web/design/model.ts";
import { apply, applyMany, group, parse, type Op } from "../../web/design/dom.ts";
import { setData, itemOp, detached, renderKey } from "../../web/design/template.ts";
import { makeRepeat, repeatAll } from "../../web/design/repeat.ts";

const OPS = ["style", "text", "delete", "duplicate", "move", "wrap", "group", "unwrap", "zorder", "reorder", "attr", "data", "item", "detach", "componentize", "repeat", "repeatAll", "styles"] as const;
const ATTRS = ["href", "src", "alt", "placeholder", "aria-label", "title"] as const;
const slug = (s: string) => s.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "Component";

function valid(a: Record<string, any>): boolean {
  if (!FILE.test(String(a.file)) || typeof a.v !== "string" || !oneOf(a.op, OPS)) return false;
  if (a.tid !== undefined && !isInt(a.tid)) return false;
  if (a.tids !== undefined && !(Array.isArray(a.tids) && a.tids.length <= 500 && a.tids.every((t: unknown) => isInt(t)))) return false;
  if (a.changes !== undefined && !isChanges(a.changes)) return false;
  if (a.text !== undefined && !isStr(a.text, 20_000)) return false;
  if (a.html !== undefined && !isStr(a.html, 60_000)) return false;
  if (a.z !== undefined && !oneOf(a.z, ["front", "back"] as const)) return false;
  if (a.dir !== undefined && !oneOf(a.dir, ["up", "down"] as const)) return false;
  if (a.layout !== undefined && !oneOf(a.layout, ["stack", "row", "grid"] as const)) return false;
  if (a.to !== undefined && !isInt(a.to)) return false;
  if (a.name !== undefined && !oneOf(a.name, ATTRS)) return false;
  if (a.value !== undefined && a.value !== null && !isStr(a.value)) return false;
  if (a.path !== undefined && !(typeof a.path === "string" && a.path.length <= 200 && /^[\w$-]+(\.[\w$-]+)*$/.test(a.path))) return false;
  if (a.action !== undefined && !oneOf(a.action, ["delete", "duplicate", "up", "down"] as const)) return false;
  if (a.title !== undefined && !(typeof a.title === "string" && a.title.trim().length >= 1 && a.title.trim().length <= 60)) return false;
  if (a.batch !== undefined && !(Array.isArray(a.batch) && a.batch.length <= 20 && a.batch.every((g: any) => g && Array.isArray(g.tids) && g.tids.length >= 1 && g.tids.length <= 500 && g.tids.every((t: unknown) => isInt(t)) && isChanges(g.changes, 2000)))) return false;
  if (a.w !== undefined && !(isNum(a.w) && a.w >= 40 && a.w <= 4000)) return false;
  if (a.h !== undefined && !(isNum(a.h) && a.h >= 40 && a.h <= 20000)) return false;
  return true;
}

export default route(async (c) => {
  const { tab, state: st } = await designTab(c);
  const a = await jsonBody(c);
  if (!a || !valid(a)) return bad();
  if (a.title !== undefined) a.title = String(a.title).trim();
  const src = st.files?.[a.file];
  if (src === undefined) return new Response("not found", { status: 404 });
  if (version(src) !== a.v) return Response.json({ error: "stale", v: version(src) }, { status: 409 });
  const title = st.boards[a.file]?.title ?? a.file;
  const files = { ...st.files }, boards = { ...st.boards }, order = [...st.order];
  let note = "";
  const out: Record<string, unknown> = {};
  const write = (n: string) => c.h.fns.canvas.write({ itemId: tab.id, args: { ...st, files, boards, order } as DesignState, note: `${title}: ${n}`, author: me(c) });

  if (a.op === "data" || a.op === "item") {
    if (!a.path) return Response.json({ error: "bad" }, { status: 400 });
    const r = a.op === "data" ? setData(src, a.path, a.text ?? "") : itemOp(src, a.path, a.action ?? "delete");
    if ("error" in r) return Response.json(r, { status: r.error === "stale" ? 409 : 422 });
    files[a.file] = r.html; note = a.op === "data" ? `data ${a.path}` : `${a.action} item ${a.path}`;
    if ("item" in r) out.item = r.item;
  } else if (a.op === "styles") {
    // several style edits at once (a colour replaced everywhere it paints): style keeps every tid where it is
    let h = src;
    for (const g of a.batch ?? []) { const r = applyMany(h, { op: "style", tid: g.tids[0]!, changes: g.changes }, g.tids); if ("error" in r) { if (r.error === "edge") continue; return Response.json(r, { status: 409 }); } h = r.html; }
    files[a.file] = h; note = `recoloured ${(a.batch ?? []).reduce((n: number, g: any) => n + g.tids.length, 0)} element(s)`;
  } else if (a.op === "repeatAll") {
    const r = repeatAll(src);
    if (!r.made.length && r.html === src) return Response.json({ error: "no_twins" }, { status: 422 });
    files[a.file] = r.html; note = `made repeats (${r.made.map((m) => `${m.count} × ${m.tag}`).join(", ")})`; out.made = r.made.length;
  } else if (a.op === "repeat") {
    const r = makeRepeat(src, a.tid ?? -1);
    if ("error" in r) return Response.json(r, { status: r.error === "stale" ? 409 : 422 });
    files[a.file] = r.html; note = `made ${r.count} copies one repeat (${r.key})`; Object.assign(out, { select: r.tid, key: r.key });
  } else if (a.op === "detach" || a.op === "componentize") {
    const els = parse(src), el = a.tid === undefined ? undefined : els[a.tid];
    if (!el) return Response.json({ error: "stale" }, { status: 409 });
    if (a.op === "detach") {
      if (el.tag !== "dc-import") return Response.json({ error: "not_instance" }, { status: 422 });
      const h = detached(src, el, st.files);
      if (h === null) return Response.json({ error: "missing" }, { status: 422 });
      files[a.file] = src.slice(0, el.start) + h + src.slice(el.end); note = `detached #${el.tid}`;
    } else {
      const outer = src.slice(el.start, el.end);
      for (let x = el.parent; x; x = x.parent) if (x.tag === "dc-for" || x.tag === "dc-if") return Response.json({ error: "in_repeat" }, { status: 422 });
      if (outer.includes("{{") || ["html", "head", "body"].includes(el.tag)) return Response.json({ error: "bound" }, { status: 422 });
      const base = slug(a.title ?? "Component");
      let file = `${base}.html`, n = 1;
      while (files[file]) file = `${base}-${++n}.html`;
      const w = Math.round(a.w ?? 320), h = Math.round(a.h ?? 120);
      files[file] = outer;
      // on the page of the board it came from
      const sheet = st.boards[a.file]?.sheet;
      boards[file] = { ...placeNew(st, w, h, sheetOf(st, st.boards[a.file] ?? {})), w, h, title: a.title ?? base, ...(sheet ? { sheet } : {}) };
      order.push(file);
      files[a.file] = src.slice(0, el.start) + `<dc-import src="${file}"></dc-import>` + src.slice(el.end);
      note = `made #${el.tid} a component (${file})`; out.component = file;
    }
    out.select = a.tid;
  } else {
    const tids: number[] = a.tids?.length ? a.tids : a.tid !== undefined ? [a.tid] : [];
    if (!tids.length) return Response.json({ error: "bad" }, { status: 400 });
    const t0 = tids[0]!;
    // several siblings into one group
    if (a.op === "group") {
      const r = group(src, tids, a.layout === "row" ? "row" : "stack");
      if ("error" in r) return Response.json(r, { status: 422 });
      files[a.file] = r.html;
      await write(r.note);
      return Response.json({ v: version(r.html), k: renderKey(a.file, files), select: r.select });
    }
    const op: Op = a.op === "style" ? { op: "style", tid: t0, changes: a.changes ?? {} } : a.op === "text" ? { op: "text", tid: t0, text: a.text ?? "", template: a.template, ...(a.html !== undefined ? { html: a.html } : {}) }
      : a.op === "zorder" ? { op: "zorder", tid: t0, dir: a.z ?? "front" } : a.op === "unwrap" ? { op: "unwrap", tid: t0 }
      : a.op === "move" ? { op: "move", tid: t0, dir: a.dir ?? "down" } : a.op === "wrap" ? { op: "wrap", tid: t0, layout: a.layout ?? "stack" }
      : a.op === "reorder" ? { op: "reorder", tid: t0, to: a.to ?? 0 } : a.op === "attr" ? { op: "attr", tid: t0, name: a.name ?? "title", value: a.value ?? null }
      : { op: a.op as "delete" | "duplicate", tid: t0 };
    const r = tids.length > 1 ? applyMany(src, op, tids) : apply(src, op);
    if ("error" in r) return Response.json(r, { status: r.error === "stale" ? 409 : 422 });
    files[a.file] = r.html; note = r.note; out.select = r.select;
  }
  await write(note);
  return Response.json({ v: version(files[a.file]!), k: renderKey(a.file, files), ...out });
});
