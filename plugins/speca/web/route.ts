// How a Speca route file talks to Hyper: `export default route(async (c) => …)` in src/speca/$route_<path>_<METHOD>.ts.
// The handler gets Speca's request shape (the person, their language, the form) and returns markup, a Response or JSON;
// markup goes out as a fragment with the stylesheet versions (x-dh-css) Speca's app.js keeps in step with.
// Hyper owns the address table, auth and the session; nothing here routes or rewrites URLs.
import { isRaw, type Raw } from "./html.ts";
import { makeT, type Locale } from "./i18n/i18n.ts";
import type { T, UserRow } from "./types.ts";
import { me as loadMe } from "./hyper.ts";
import { useHyper } from "./views/sidebar.ts";
import { cssVersions } from "./views/layout.ts";
import { registerIconSet } from "./ui/icons.ts";
import { join } from "node:path";

export type Ctx = {
  /** Hyper's request context: ctx.fns.*, ctx.state. */
  h: any; session: any; req: Request; url: URL; params: Record<string, string>;
  user: UserRow; t: T; csrf: string; hx: boolean;
  form(): Promise<Record<string, string>>; formAll(): Promise<FormData>;
};

export function toast(title: string, description = "", category: "success" | "error" | "info" = "success", more: Record<string, unknown> = {}): Response {
  // a header holds only ASCII: the JSON keeps every other character as a \uXXXX escape (htmx parses it back)
  const json = JSON.stringify({ "dh-toast": { title, description, category }, ...more }).replace(/[\u007f-\uffff]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return new Response(null, { status: 204, headers: { "HX-Trigger": json } });
}

export function redirect(c: Ctx, to: string): Response {
  return c.hx ? new Response(null, { status: 204, headers: { "HX-Redirect": to } }) : new Response(null, { status: 303, headers: { location: to } });
}

export const noContent = () => new Response(null, { status: 204 });

export function answer(v: unknown, origin?: string): Response {
  if (v instanceof Response) return v;
  if (v == null) return noContent();
  if (isRaw(v) || typeof v === "string") {
    let body = isRaw(v) ? (v as Raw).html : (v as string);
    // a whole page says where the server itself is: shown through a proxy (Speca's browser tab), the page's frames
    // load from here — the proxy does not let a page frame its own address (app.js, "frames behind a proxy")
    if (origin && body.startsWith("<!doctype")) body = body.replace("<head>", `<head><meta name="dh-origin" content="${origin.replace(/"/g, "")}">`);
    return new Response(body, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-dh-css": cssVersions() } });
  }
  return Response.json(v, { headers: { "cache-control": "no-store" } });
}

// Hyper's kinds and plugins name Phosphor icons ("file", "browser"): `ic("ph:file")` draws them from Hyper's icon set
let iconsSet = false;
function useIcons() {
  if (iconsSet) return;
  iconsSet = true;
  registerIconSet("ph", join(import.meta.dir, "..", "..", "icons", "assets", "icons"));
}

export async function makeCtx(h: any, session: any, req: Request, params: Record<string, string>): Promise<Ctx> {
  useHyper(h);
  useIcons();
  const user = await loadMe(h, session);
  const locale: Locale = user.locale === "en" ? "en" : "ru";
  let formCache: FormData | null = null;
  const formAll = async () => (formCache ??= await req.clone().formData().catch(() => new FormData()));
  return {
    h, session, req, url: new URL(req.url), params: { ...params }, user, t: makeT(locale), csrf: "local", hx: req.headers.get("hx-request") === "true",
    formAll,
    async form() { const fd = await formAll(); const o: Record<string, string> = {}; fd.forEach((v, k) => { if (typeof v === "string" && !(k in o)) o[k] = v; }); return o; },
  };
}

/** A Hyper route handler from a Speca one. */
export function route(fn: (c: Ctx) => unknown) {
  return async function (h: any, session: any, opts: { req: Request; params?: Record<string, string> }): Promise<Response> {
    const c = await makeCtx(h, session, opts.req, opts.params ?? {});
    try { return answer(await fn(c), c.url.origin); }
    catch (e: any) {
      const msg = String(e?.message ?? e);
      h.fns?.procs?.log?.warn?.({ event: "speca.route", msg: `${opts.req.method} ${c.url.pathname}: ${msg}` });
      if (c.hx) return toast(msg, "", "error");
      return new Response(`<pre>${msg.replace(/</g, "&lt;")}</pre>`, { status: 500, headers: { "content-type": "text/html; charset=utf-8" } });
    }
  };
}
