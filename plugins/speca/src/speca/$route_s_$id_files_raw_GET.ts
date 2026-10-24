// GET /speca/s/:id/files/raw?path[&download=1] — the bytes, for an image preview or a download; never a page of
// this origin (an opaque sandbox even if opened directly: an svg's scripts, an html file).
import { route } from "../../web/route.ts";
import { rawProjectFile } from "../../web/code/files.ts";
import { codeOf, filesErr } from "../../web/code/routes.ts";

export default route(async (c) => {
  const { dir, h } = await codeOf(c);
  try {
    const f = await rawProjectFile(h, dir, String(c.url.searchParams.get("path") ?? ""));
    const down = c.url.searchParams.get("download") === "1";
    return new Response(f.bytes as Uint8Array<ArrayBuffer>, { headers: { "content-type": down ? "application/octet-stream" : f.mime, "content-security-policy": "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'", "x-content-type-options": "nosniff",
      ...(down ? { "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}` } : {}) } });
  } catch (e) { const r = filesErr(e); if (r) return r; throw e; }
});
