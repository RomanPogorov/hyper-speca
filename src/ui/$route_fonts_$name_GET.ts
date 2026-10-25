// GET /ui/fonts/:name — the interface typeface (Golos Text, SIL Open Font License), served from our own origin
// so the page never waits on a font host.
import { resolve } from "node:path";

const DIR = resolve(import.meta.dir, "fonts");

/** Serves one bundled .woff2 font file. */
export default async function (_ctx: Context, _session: Session | null, opts: {
        /** Route parameters captured from the request path. */ params: Record<string, string> }) {
    const name = String(opts.params.name ?? "");
    if (!/^[a-z0-9-]+\.woff2$/.test(name)) return new Response("unknown font", { status: 404 });
    const file = Bun.file(resolve(DIR, name));
    if (!(await file.exists())) return new Response("unknown font", { status: 404 });
    return new Response(file, { headers: { "content-type": "font/woff2", "cache-control": "public, max-age=31536000, immutable" } });
}
