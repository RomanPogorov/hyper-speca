// POST /speca/design/layout/:tab — the person arranging the canvas by hand: drag boards (one or several) and notes,
// rename, resize, duplicate or delete boards, add, edit and delete stickies, add, rename and remove pages, move things
// to a page. Same index the agent's speca.designLayout changes; comments are the canvas's own (/speca/canvas/:tab/comments).
import { route } from "../../web/route.ts";
import { me } from "../../web/canvasApi.ts";
import { designTab, jsonBody, bad, isInt, isNum } from "../../web/design/routes.ts";
import { FILE, GAP_X, placeNew, sheetOf, sheetsOf, type DesignState } from "../../web/design/model.ts";

const ID = /^[\w-]{1,40}$/;
const isFile = (v: unknown) => typeof v === "string" && FILE.test(v);
const opt = (v: unknown, ok: (x: unknown) => boolean) => v === undefined || ok(v);
const files = (v: unknown) => Array.isArray(v) && v.length <= 200 && v.every(isFile);
const strs = (v: unknown) => Array.isArray(v) && v.length <= 200 && v.every((x) => typeof x === "string");
const title = (v: unknown, max: number) => typeof v === "string" && v.trim().length >= 1 && v.trim().length <= max;

function valid(o: Record<string, any>): boolean {
  switch (o.op) {
    case "move": return isFile(o.file) && isNum(o.x) && isNum(o.y);
    case "moveMany": return Array.isArray(o.items) && o.items.length >= 1 && o.items.length <= 200
      && o.items.every((it: any) => it && opt(it.file, isFile) && opt(it.note, (x) => typeof x === "string") && isNum(it.x) && isNum(it.y));
    case "removeMany": return files(o.files) && opt(o.notes, strs);
    case "rename": return isFile(o.file) && title(o.title, 120);
    case "resize": return isFile(o.file) && isInt(o.w, 40) && o.w <= 4000 && isInt(o.h, 40) && o.h <= 20000;
    case "duplicate": return isFile(o.file) && opt(o.x, isNum) && opt(o.y, isNum);
    case "remove": return isFile(o.file);
    case "note": return opt(o.id, (x) => typeof x === "string" && ID.test(x)) && opt(o.text, (x) => typeof x === "string" && x.length <= 2000)
      && opt(o.x, isNum) && opt(o.y, isNum) && opt(o.sheet, (x) => typeof x === "string" && ID.test(x));
    case "removeNote": return typeof o.id === "string";
    case "sheet": return opt(o.id, (x) => typeof x === "string" && ID.test(x)) && title(o.title, 80);
    case "removeSheet": return typeof o.id === "string";
    case "toSheet": return files(o.files) && opt(o.notes, strs) && typeof o.sheet === "string";
    default: return false;
  }
}

export default route(async (c) => {
  const { tab, state } = await designTab(c);
  const o = await jsonBody(c);
  if (!o || !valid(o)) return bad();
  if (typeof o.title === "string") o.title = o.title.trim();
  const s = structuredClone(state) as DesignState;
  s.notes ??= {};
  let note = "", out: Record<string, unknown> = {};
  if ("file" in o && !s.boards[o.file]) return new Response("not found", { status: 404 });
  if (o.op === "move") { Object.assign(s.boards[o.file]!, { x: Math.round(o.x), y: Math.round(o.y) }); note = `moved ${s.boards[o.file]!.title}`; }
  if (o.op === "moveMany") {
    for (const it of o.items) {
      const t = it.file ? s.boards[it.file] : it.note ? s.notes[it.note] : undefined;
      if (t) Object.assign(t, { x: Math.round(it.x), y: Math.round(it.y) });
    }
    note = `moved ${o.items.length} item(s)`;
  }
  if (o.op === "removeMany") {
    for (const f of o.files) { delete s.boards[f]; delete s.files[f]; }
    s.order = s.order.filter((f) => s.boards[f]);
    for (const n of o.notes ?? []) delete s.notes[n];
    note = `removed ${o.files.length + (o.notes?.length ?? 0)} item(s)`;
  }
  if (o.op === "resize") { Object.assign(s.boards[o.file]!, { w: o.w, h: o.h }); note = `resized ${s.boards[o.file]!.title} to ${o.w}×${o.h}`; }
  if (o.op === "rename") { note = `renamed ${s.boards[o.file]!.title} → ${o.title}`; s.boards[o.file]!.title = o.title; }
  if (o.op === "remove") { note = `removed ${s.boards[o.file]!.title}`; delete s.boards[o.file]; delete s.files[o.file]; s.order = s.order.filter((f) => f !== o.file); }
  if (o.op === "duplicate") {
    const b = s.boards[o.file]!, base = String(o.file).replace(/(-copy\d*)?\.html$/, "");
    let n = 1, file = `${base}-copy.html`;
    while (s.boards[file] || s.files[file]) file = `${base}-copy${++n}.html`;
    s.boards[file] = { ...b, x: Math.round(o.x ?? b.x + b.w + GAP_X), y: Math.round(o.y ?? b.y), title: `${b.title} copy` };
    s.files[file] = s.files[o.file] ?? "";
    s.order.splice(s.order.indexOf(o.file) + 1, 0, file);
    note = `duplicated ${b.title}`; out = { file };
  }
  if (o.op === "note") {
    const id = o.id ?? `n${Date.now().toString(36)}`, cur = s.notes[id];
    if (!cur && (o.x === undefined || o.y === undefined)) return bad();
    const first = sheetsOf(s)[0]!.id;
    const sheet = cur?.sheet ?? (o.sheet && sheetsOf(s).some((p) => p.id === o.sheet) && o.sheet !== first ? o.sheet : undefined);
    s.notes[id] = { kind: cur?.kind ?? "sticky", text: o.text ?? cur?.text ?? "", x: Math.round(o.x ?? cur!.x), y: Math.round(o.y ?? cur!.y), ...(cur?.w ? { w: cur.w } : {}), ...(sheet ? { sheet } : {}) };
    note = cur ? (o.text !== undefined ? "edited a note" : "moved a note") : "added a note"; out = { id };
  }
  if (o.op === "removeNote") { if (!s.notes[o.id]) return new Response("not found", { status: 404 }); delete s.notes[o.id]; note = "removed a note"; }
  if (o.op === "sheet") {
    // the first page is named the first time there are two: what was there stays on it
    s.sheets = [...sheetsOf(s)].map((p) => (p.title ? p : { ...p, title: o.id === p.id ? o.title : "Страница 1" }));
    const cur = o.id ? s.sheets.find((p) => p.id === o.id) : null;
    if (cur) { note = `renamed page ${cur.title} → ${o.title}`; cur.title = o.title; out = { id: cur.id }; }
    else { const id = `p${Date.now().toString(36)}`; s.sheets.push({ id, title: o.title }); note = `added page ${o.title}`; out = { id }; }
  }
  if (o.op === "removeSheet") {
    const list = sheetsOf(s);
    if (list.length < 2 || !list.some((p) => p.id === o.id)) return new Response("not found", { status: 404 });
    if (Object.values(s.boards).some((b) => sheetOf(s, b) === o.id) || Object.values(s.notes).some((n) => sheetOf(s, n) === o.id)) return Response.json({ error: "not_empty" }, { status: 409 });
    s.sheets = list.filter((p) => p.id !== o.id); note = "removed a page";
    if (s.sheets.length === 1 && s.sheets[0]!.id === "main") delete s.sheets;
  }
  if (o.op === "toSheet") {
    if (!sheetsOf(s).some((p) => p.id === o.sheet)) return new Response("not found", { status: 404 });
    for (const f of o.files) { const b = s.boards[f]; if (!b) continue; Object.assign(b, placeNew(s, b.w, b.h, o.sheet), { sheet: o.sheet }); }
    for (const n of o.notes ?? []) { const x = s.notes[n]; if (x) x.sheet = o.sheet; }
    note = `moved ${o.files.length + (o.notes?.length ?? 0)} item(s) to page ${sheetsOf(s).find((p) => p.id === o.sheet)?.title ?? o.sheet}`;
  }
  await c.h.fns.canvas.write({ itemId: tab.id, args: s, note, author: me(c) });
  return Response.json(out);
});
