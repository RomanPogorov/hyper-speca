/**
 * Decides whether the HTTPS listener serves an ordinary (non-WebSocket) request.
 *
 * HTTP/2 requests are always served. HTTP/1.1 requests are served unless HYPER_H2_HTTP1=off.
 * WebSocket upgrades never reach this check: they arrive as `upgrade` events and go to h2.wsProxy,
 * so turning HTTP/1.1 off cannot break live view or any other `$ws_` endpoint.
 * @param opts.httpVersion Protocol version reported by node:http2 for the request, e.g. "2.0" or "1.1".
 * @param opts.http1 Whether ordinary HTTP/1.1 requests are allowed (HYPER_H2_HTTP1 not off).
 */
export default function (_ctx: Context, _session: Session | null, opts: {
    /** Protocol version reported by node:http2 for the request, e.g. "2.0" or "1.1". */
    httpVersion: string;
    /** Whether ordinary HTTP/1.1 requests are allowed (HYPER_H2_HTTP1 not off). */
    http1: boolean;
}): boolean {
    return opts.http1 || String(opts.httpVersion).startsWith("2");
}
