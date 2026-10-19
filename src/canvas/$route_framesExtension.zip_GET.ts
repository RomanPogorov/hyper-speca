// GET /canvas/framesExtension.zip — the "Hyper canvas frames" Chrome extension (extensions/canvas-frames
// in the code repo) packed as a zip on request, so every Hyper instance hands out the version it runs and
// the canvas url tab can link to it when the extension is missing. Stored (no compression): a few small
// text files, and no zip dependency.
import { readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Serves the Hyper canvas frames Chrome extension as a zip built from the repository folder.
 * @param opts.req Incoming HTTP request.
 */
export default async function (ctx: Context, _session: Session | null, _opts: { req: Request }): Promise<Response> {
    const dir = join(ctx.fns.procs.project.projectRoot({}), "extensions", "canvas-frames");
    const names = (await readdir(dir, { withFileTypes: true })).filter(e => e.isFile()).map(e => e.name).sort();
    if (!names.includes("manifest.json")) return new Response("canvas frames extension is not in this build", { status: 404 });
    const files = await Promise.all(names.map(async name => ({ name: `hyper-canvas-frames/${name}`, data: new Uint8Array(await Bun.file(join(dir, name)).arrayBuffer()) })));
    return new Response(storedZip(files), {
        headers: {
            "content-type": "application/zip",
            "content-disposition": 'attachment; filename="hyper-canvas-frames.zip"',
            "cache-control": "no-store",
        },
    });
}

// Minimal PKZIP writer, method 0 (stored): local headers + data, central directory, end record.
function storedZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
    const enc = new TextEncoder();
    const local: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;
    for (const f of files) {
        const name = enc.encode(f.name);
        const crc = Bun.hash.crc32(f.data) >>> 0;
        const head = new DataView(new ArrayBuffer(30));
        head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x0800, true);
        head.setUint32(14, crc, true); head.setUint32(18, f.data.length, true); head.setUint32(22, f.data.length, true);
        head.setUint16(26, name.length, true);
        local.push(new Uint8Array(head.buffer), name, f.data);
        const dirEntry = new DataView(new ArrayBuffer(46));
        dirEntry.setUint32(0, 0x02014b50, true); dirEntry.setUint16(4, 20, true); dirEntry.setUint16(6, 20, true); dirEntry.setUint16(8, 0x0800, true);
        dirEntry.setUint32(16, crc, true); dirEntry.setUint32(20, f.data.length, true); dirEntry.setUint32(24, f.data.length, true);
        dirEntry.setUint16(28, name.length, true); dirEntry.setUint32(42, offset, true);
        central.push(new Uint8Array(dirEntry.buffer), name);
        offset += 30 + name.length + f.data.length;
    }
    const centralSize = central.reduce((s, b) => s + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
    const parts = [...local, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(parts.reduce((s, b) => s + b.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
}
