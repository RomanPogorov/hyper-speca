// Startup probe for the WebSocket path through the HTTPS door: TLS with ALPN
// http/1.1 (what browsers use for a socket), an Upgrade request, and whatever
// status line comes back. Any HTTP answer means the upgrade reached the inner
// server through h2.wsProxy; a refused handshake, reset or silence means
// browsers will show live view as disconnected on this address.
import tls from "node:tls";

/**
 * Checks that a WebSocket upgrade passes through the local HTTPS/HTTP2 listener to the inner HTTP server.
 *
 * Opens a TLS connection to 127.0.0.1:<port> negotiating HTTP/1.1, sends a WebSocket upgrade for a path no
 * endpoint serves, and reports the first status line. Used by h2 startup to log `h2.ws-ok` or `h2.ws-blocked`;
 * call it by hand when live view shows "disconnected" to tell a broken HTTPS port from a broken proxy in front.
 * @param opts.port HTTPS listener port.
 * @param opts.servername TLS SNI name (the certificate's name). @default "localhost"
 * @param opts.timeoutMs Give up after this long. @default 5000 @minimum 100 @maximum 60000
 */
export default async function (_ctx: Context, _session: Session | null, opts: {
    /** HTTPS listener port. */
    port: number;
    /** TLS SNI name (the certificate's name). @default "localhost" */
    servername?: string;
    /** Give up after this long. @default 5000 @minimum 100 @maximum 60000 */
    timeoutMs?: number;
}): Promise<{ ok: boolean; detail: string }> {
    const timeoutMs = Math.max(100, Math.min(60_000, opts.timeoutMs ?? 5000));
    const servername = opts.servername || "localhost";
    return await new Promise((resolve) => {
        let done = false;
        const finish = (ok: boolean, detail: string) => { if (done) return; done = true; clearTimeout(timer); try { sock.destroy(); } catch { /* closed */ } resolve({ ok, detail }); };
        const timer = setTimeout(() => finish(false, `no answer in ${timeoutMs} ms`), timeoutMs);
        const sock = tls.connect({ host: "127.0.0.1", port: opts.port, servername, ALPNProtocols: ["http/1.1"], rejectUnauthorized: false }, () => {
            if (sock.alpnProtocol && sock.alpnProtocol !== "http/1.1") return finish(false, `ALPN chose ${sock.alpnProtocol}, not http/1.1`);
            sock.write([
                "GET /h2/ws-self-check HTTP/1.1", `Host: ${servername}:${opts.port}`, "Upgrade: websocket", "Connection: Upgrade",
                "Sec-WebSocket-Version: 13", `Sec-WebSocket-Key: ${btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))}`, "", "",
            ].join("\r\n"));
        });
        let buf = "";
        sock.on("data", (d: Buffer) => {
            buf += d.toString("latin1");
            const line = buf.split("\r\n")[0] ?? "";
            if (buf.includes("\r\n")) finish(/^HTTP\/1\.1 \d{3}/.test(line), line.slice(0, 120));
        });
        sock.on("error", (e: any) => finish(false, e?.code ? `${e.code}: ${e.message}` : String(e?.message ?? e)));
        sock.on("close", () => finish(false, buf ? `closed after "${buf.slice(0, 60)}"` : "connection closed without an answer"));
    });
}
