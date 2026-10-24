// The design canvas model: an index of artboards (where each one sits, its size and title, row titles) and one HTML
// file per artboard. Every element of an artboard has an address: its tid — the preorder index of the element in the
// file — plus the path of child indexes; "File.html#tid:path". The same address is used by the selection, by "this
// element" in chat and by the agent's edits.
export const FILE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,60}\.html$/;
export const SHEET = /^[\w-]{1,40}$/;

export type Board = { x: number; y: number; w: number; h: number; title: string; page?: boolean;
  /** the page (sheet) of the canvas it is on; none: the first */
  sheet?: string;
  /** planned, not drawn yet: the canvas shows its frame waiting (the agent draws boards one by one) */
  pending?: boolean };
export type Note = { kind: "title" | "sticky"; text: string; x: number; y: number; w?: number; sheet?: string };
/** The pages of a canvas (several sets of artboards, each on its own camera); none: one page. */
export type Sheet = { id: string; title: string };
export type DesignState = { title?: string; order: string[]; boards: Record<string, Board>; notes?: Record<string, Note>; files: Record<string, string>; comments?: Record<string, unknown>; sheets?: Sheet[] };

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const obj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);

/** The state checked the way the canvas stores it; a message says what is wrong. */
export function checkState(x: unknown): { ok: true; state: DesignState } | { ok: false; error: string } {
  if (!obj(x)) return { ok: false, error: "state must be an object" };
  if (x.title !== undefined && !str(x.title, 200)) return { ok: false, error: "title: a string up to 200" };
  if (!Array.isArray(x.order) || x.order.length > 200 || !x.order.every((f: unknown) => typeof f === "string")) return { ok: false, error: "order: up to 200 file names" };
  if (!obj(x.boards)) return { ok: false, error: "boards: an object" };
  for (const [f, b] of Object.entries(x.boards)) {
    if (!obj(b) || !num(b.x) || !num(b.y) || !num(b.w) || b.w < 40 || b.w > 4000 || !num(b.h) || b.h < 40 || b.h > 20000 || !str(b.title, 120)) return { ok: false, error: `boards.${f}: {x, y, w 40–4000, h 40–20000, title}` };
    if (b.sheet !== undefined && !(typeof b.sheet === "string" && SHEET.test(b.sheet))) return { ok: false, error: `boards.${f}.sheet` };
  }
  if (x.notes !== undefined) {
    if (!obj(x.notes)) return { ok: false, error: "notes: an object" };
    for (const [id, n] of Object.entries(x.notes)) if (!obj(n) || (n.kind !== "title" && n.kind !== "sticky") || !str(n.text, 2000) || !num(n.x) || !num(n.y)) return { ok: false, error: `notes.${id}: {kind title|sticky, text, x, y}` };
  }
  if (!obj(x.files)) return { ok: false, error: "files: an object of html" };
  for (const [f, h] of Object.entries(x.files)) if (!str(h, 400_000)) return { ok: false, error: `files.${f}: html up to 400000` };
  if (x.sheets !== undefined && !(Array.isArray(x.sheets) && x.sheets.length <= 50 && x.sheets.every((p: any) => obj(p) && typeof p.id === "string" && SHEET.test(p.id) && str(p.title, 80)))) return { ok: false, error: "sheets: [{id, title}]" };
  return { ok: true, state: x as DesignState };
}
/** The version of an artboard file the frame was served from; edits name it so a stale view never writes. */
export const version = (src: string) => Bun.hash(src).toString(36);

// Claude Design's grid: 80 between boards, 120 between rows; a row title (72px) sits 300 above its row, as wide as the row.
export const GAP_X = 80, GAP_Y = 120, TITLE_ABOVE = 300;

/** Lay rows out on the canvas grid: boards 80px apart, rows 120px apart, the row title above each row. */
export function layoutRows(rows: Array<{ title?: string; boards: Array<{ file: string; w: number; h: number; title: string; page?: boolean }> }>): Pick<DesignState, "order" | "boards" | "notes"> {
  const boards: DesignState["boards"] = {};
  const notes: NonNullable<DesignState["notes"]> = {};
  const order: string[] = [];
  let y = 0;
  rows.forEach((row, i) => {
    const width = row.boards.reduce((w, b) => w + b.w, 0) + GAP_X * Math.max(0, row.boards.length - 1);
    if (row.title) { notes[`row${i + 1}`] = { kind: "title", text: row.title, x: 0, y, w: Math.max(width, 390) }; y += TITLE_ABOVE; }
    let x = 0, hmax = 0;
    for (const b of row.boards) { boards[b.file] = { x, y, w: b.w, h: b.h, title: b.title, ...(b.page ? { page: true } : {}) }; order.push(b.file); x += b.w + GAP_X; hmax = Math.max(hmax, b.h); }
    y += hmax + GAP_Y;
  });
  return { order, boards, notes };
}

/** The canvas's pages, in order (one unnamed page when it has none). */
export function sheetsOf(s: Pick<DesignState, "sheets">): Array<{ id: string; title: string }> {
  return s.sheets?.length ? s.sheets : [{ id: "main", title: "" }];
}
/** The page a board or note is on. */
export const sheetOf = (s: Pick<DesignState, "sheets">, x: { sheet?: string }) => (x.sheet && sheetsOf(s).some((p) => p.id === x.sheet) ? x.sheet : sheetsOf(s)[0]!.id);

/** Where a new board goes: to the right of the last row (of its page). */
export function placeNew(s: DesignState, w: number, h: number, sheet?: string): { x: number; y: number } {
  const all = Object.values(s.boards).filter((b) => !sheet || sheetOf(s, b) === sheet);
  if (!all.length) return { x: 0, y: 0 };
  const lastY = Math.max(...all.map((b) => b.y));
  const row = all.filter((b) => b.y === lastY);
  const right = Math.max(...row.map((b) => b.x + b.w));
  return { x: right + GAP_X, y: lastY };
}

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/** A readable outline of a file for the agent: tid, tag and the first words of each text-bearing element. */
export async function outline(html: string): Promise<string> {
  type Node = { tid: number; tag: string; text: string; depth: number };
  const all: Node[] = [];
  const stack: Node[] = [];
  let n = 0;
  await new HTMLRewriter()
    .on("*", {
      element(el) {
        const node: Node = { tid: n++, tag: el.tagName, text: "", depth: stack.length };
        all.push(node);
        // void and self-closing tags (an svg <path/>) have no end tag: asking for one throws
        if (VOID.has(el.tagName) || el.selfClosing || !el.canHaveContent) return;
        stack.push(node);
        el.onEndTag(() => { stack.pop(); });
      },
    })
    .onDocument({ text(t) { const top = stack[stack.length - 1]; if (top && top.text.length < 48) top.text += t.text.replace(/\s+/g, " "); } })
    .transform(new Response(html)).text();
  return all.slice(0, 400).map((c) => `${"  ".repeat(Math.min(c.depth, 8))}#${c.tid} ${c.tag}${c.text.trim() ? ` "${c.text.trim().slice(0, 40)}"` : ""}`).join("\n");
}

export function emptyState(title?: string): DesignState {
  return { title, order: [], boards: {}, notes: {}, files: {} };
}
