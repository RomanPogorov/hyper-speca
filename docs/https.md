# HTTPS / HTTP/2

Hyper listens on two ports:

| Port | Protocol | Who uses it |
|------|----------|-------------|
| `PORT` (3010) | plain HTTP/1.1 | `hyper` CLI, `bun script/repl.ts`, browser extension, FRP tunnel |
| `H2_PORT` (3443) | HTTPS + HTTP/2 | browsers on this Mac and devices on the tailnet |

Why: over HTTP/1.1 Chrome allows 6 connections per origin and every visible tab
keeps one for live updates, so many tabs starve each other. HTTP/2 multiplexes
everything over one connection.

## Default (on)

- The certificate comes from `tailscale cert <mac>.<tailnet>.ts.net` (Let's Encrypt,
  trusted by macOS/iOS as is), renewed on every start. HTTPS Certificates must be
  enabled in the Tailscale admin (DNS page). Without Tailscale a self-signed
  `localhost` certificate is used.
- A browser opening a page on `http://localhost:3010` is redirected (302) to
  `https://<mac>.<tailnet>.ts.net:3443/...`. Only top-level page loads are redirected;
  htmx/fetch, SSE, the extension sidebar, the CLI and tunnel traffic stay on HTTP.
- Loopback-only endpoints (`/procs/repl`, `/external/*`, sidebar bridge) are NOT
  reachable through 3443: the HTTPS listener marks requests as forwarded.

## Switches (env, e.g. in the launchd plist)

```
HYPER_HTTPS=off           # old behaviour: plain HTTP on PORT only, no redirect
HYPER_HTTPS_REDIRECT=off  # keep HTTPS on 3443, but no http:// → https:// redirect
H2_PORT=3443              # HTTPS port
H2_HOST=0.0.0.0           # HTTPS bind address
HYPER_H2_HTTP1=off        # HTTP/2 only for ordinary requests (HTTP/1.1 ones get 505)
```

## WebSockets always pass

Browsers open a WebSocket (live view, `/browser/live/socket`, any `$ws_` endpoint) over a
separate HTTP/1.1 connection: Hyper does not announce RFC 8441 WebSockets over HTTP/2, and
Bun cannot serve them. So the HTTPS port always offers `http/1.1` in ALPN, and an upgrade is
piped by `h2.wsProxy` to the plain server, whatever `HYPER_H2_HTTP1` says. That switch only
refuses ordinary HTTP/1.1 requests (status 505). Before this, `HYPER_H2_HTTP1=off` removed
HTTP/1.1 from ALPN, every WebSocket handshake failed, and live view only said "disconnected".

On start `h2.wsSelfCheck` sends one upgrade through the HTTPS port and logs `h2.ws-ok` or
`h2.ws-blocked` with the reason. Run it by hand when live view fails behind a proxy:
`await ctx.fns.h2.wsSelfCheck({ port: 3443 })` tells a broken HTTPS port from a proxy in front
that drops upgrades. The live view itself shows "WebSocket blocked: …" when the handshake never
opened, and the server's own error (e.g. "Chrome is not responding") when Chrome is the cause.
