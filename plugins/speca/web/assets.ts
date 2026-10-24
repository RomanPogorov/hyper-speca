// Speca's static files (/speca/assets/<dir>/<file>, /speca/assets/<dir>/<sub>/<file>): stylesheets, scripts, fonts, brand.
// A `?v=` address is a fixed version and is cached for good; a bare one is checked every time.
import { join } from "node:path";
import { statSync } from "node:fs";

const ROOT = join(import.meta.dir, "..", "assets");
const TYPES: Record<string, string> = { css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", svg: "image/svg+xml", png: "image/png", woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", json: "application/json", ico: "image/x-icon", webp: "image/webp" };
const SAFE = /^[A-Za-z0-9_.-]+$/;

export function asset(req: Request, parts: string[]): Response {
  if (!parts.every((p) => SAFE.test(p) && !p.startsWith("."))) return new Response("not found", { status: 404 });
  const abs = join(ROOT, ...parts);
  try { if (!statSync(abs).isFile()) throw 0; } catch { return new Response("not found", { status: 404 }); }
  const ext = parts[parts.length - 1]!.split(".").pop() ?? "";
  const versioned = new URL(req.url).searchParams.has("v");
  return new Response(Bun.file(abs), { headers: { "content-type": TYPES[ext] ?? "application/octet-stream", "cache-control": versioned ? "public, max-age=31536000, immutable" : "no-cache" } });
}
