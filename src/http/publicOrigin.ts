/**
 * Resolves the browser-visible request origin behind a trusted local reverse proxy
 *
 * Returns req.url origin normally, or a validated X-Forwarded-Proto plus X-Forwarded-Host only when the immediate TCP peer is loopback. Local reverse proxies must replace client-supplied forwarding headers. Maps Traefik's ws/wss schemes to browser http/https origins for WebSocket handshakes as well as ordinary HTTP CSRF checks. Ambiguous comma-separated forwarding values are not trusted.
 * @param opts.req Incoming browser request whose public origin is needed.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Incoming browser request whose public origin is needed. */
        req: Request;
    },
): Promise<string> {
    const req = opts.req;
    const target = new URL(req.url);
    let peer: string | undefined;
    try { peer = (ctx.state as any)?.procs?.http?.server?.server?.requestIP?.(req)?.address; }
    catch { return target.origin; }
    if (!peer || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer)) return target.origin;
    const forwardedProto = req.headers.get("x-forwarded-proto")?.trim();
    const proto = forwardedProto === "wss" ? "https" : forwardedProto === "ws" ? "http" : forwardedProto;
    const host = req.headers.get("x-forwarded-host")?.trim();
    if ((proto !== "https" && proto !== "http") || !host || !/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)) return target.origin;
    try {
        // URL validates the port and canonicalizes default ports and host case.
        return new URL(`${proto}://${host}`).origin;
    } catch { return target.origin; }
}
