// What the design canvas routes (/speca/design/…) share: the person's design tab, its state at a version or a moment
// of the draft, and an artboard page served into a sandboxed frame. Ported from Speca's plugins/design-canvas/*.route.ts.
import { join } from "node:path";
import type { Ctx } from "../route.ts";
import { ownTab } from "../canvasApi.ts";
import { checkState, FILE, type DesignState } from "./model.ts";
import { render } from "./template.ts";
import { BOARD_CSS, sandboxCsp, sandboxShim } from "./sandbox.ts";

export async function designTab(c: Ctx) {
  const { tab, s } = await ownTab(c);
  if (tab.kind !== "speca.design") throw new Error("not a design canvas");
  return { tab, s, state: tab.args as DesignState };
}

/** The state a frame shows: a saved version (?ver=), a moment of the draft (?at=) or the draft. */
export async function stateFor(c: Ctx): Promise<{ tab: any; state: DesignState } | null> {
  const { tab, state } = await designTab(c);
  const ver = Number(c.url.searchParams.get("ver")) || null, at = Number(c.url.searchParams.get("at")) || null;
  if (!ver && !at) return { tab, state };
  const body = await c.h.fns.canvas.version({ itemId: tab.id, ...(ver ? { v: ver } : { edit: at }) }).catch(() => null);
  const r = body ? checkState(body.args) : null;
  return r?.ok ? { tab, state: r.state } : null;
}

const notFound = () => new Response("not found", { status: 404 });
const PICKER = join(import.meta.dir, "..", "..", "assets", "design", "picker.js");

/** One artboard for the editor: the file rendered (repeats, branches, data, components; every element numbered by
 *  its tag in the source — data-tid) and the picker. No network: only /canvas-libs/ may load. */
export async function boardPage(c: Ctx): Promise<Response> {
  const file = c.params.file ?? "";
  const got = FILE.test(file) ? await stateFor(c) : null;
  const src = got?.state.files?.[file];
  if (src === undefined) return notFound();
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const body = render(src, got!.state.files).replace(/<script(?![^>]*\bnonce=)/gi, `<script nonce="${nonce}"`);
  const picker = await Bun.file(PICKER).text();
  return new Response(`<!doctype html><html><head><meta charset="utf-8">${sandboxShim(nonce)}<style>${BOARD_CSS}body{user-select:none;-webkit-user-select:none}[contenteditable]{outline:none;cursor:text;user-select:text;-webkit-user-select:text}*{cursor:default}</style></head><body>${body}<script nonce="${nonce}">${picker}</script></body></html>`, {
    headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": sandboxCsp(nonce, c.url.origin), "cache-control": "no-store" },
  });
}

/** An artboard as a still picture for the comparison of versions — rendered, no editor, no scripts. */
export async function snapshotPage(c: Ctx): Promise<Response> {
  const file = c.params.file ?? "";
  const got = FILE.test(file) ? await stateFor(c) : null;
  const src = got?.state.files?.[file];
  if (src === undefined) return notFound();
  const body = render(src, got!.state.files, undefined, { tids: false, depth: 0, seen: new Set() }).replace(/<script\b(?![^>]*type="application\/json")[\s\S]*?<\/script>/gi, "");
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><style>${BOARD_CSS}html,body{overflow:hidden}</style></head><body>${body}</body></html>`, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
      "content-security-policy": `sandbox; default-src 'none'; style-src 'unsafe-inline' ${c.url.origin}/canvas-libs/; font-src data:; img-src data: blob:; frame-ancestors 'self' http://localhost:* http://*.localhost:* http://127.0.0.1:*` },
  });
}

/** The JSON body of an editor request (null when it is not an object). */
export async function jsonBody(c: Ctx): Promise<Record<string, any> | null> {
  const v = await c.req.clone().json().catch(() => null);
  return v && typeof v === "object" && !Array.isArray(v) ? v : null;
}

// ---- small checks of the editor's requests (Speca checked them with zod) ----
export const isInt = (v: unknown, min = 0) => Number.isInteger(v) && (v as number) >= min;
export const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);
export const isStr = (v: unknown, max = 400_000) => typeof v === "string" && v.length <= max;
export const oneOf = <T extends string>(v: unknown, list: readonly T[]): v is T => typeof v === "string" && (list as readonly string[]).includes(v);
const PROP = /^-?-?[a-z][a-z0-9-]*$/;
export const isChanges = (v: unknown, max = 400_000) => !!v && typeof v === "object" && !Array.isArray(v) && Object.entries(v as object).every(([k, x]) => PROP.test(k) && (x === null || isStr(x, max)));
export const bad = () => new Response("bad request", { status: 400 });
export const forbidden = () => new Response("forbidden", { status: 403 });
