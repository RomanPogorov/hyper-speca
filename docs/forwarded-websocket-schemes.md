# Browser origins from forwarded WebSocket schemes

`http.publicOrigin` now normalizes `X-Forwarded-Proto: wss` to `https`, and `ws` to `http`, when the immediate TCP peer is loopback. Traefik uses these schemes for WebSocket upgrades; browsers send HTTP/HTTPS Origin values. Ordinary forwarded `http` and `https` remain supported.

Forwarding metadata is accepted only from `127.0.0.1`, `::1`, or `::ffff:127.0.0.1`. The trusted local proxy must replace client-supplied forwarding headers. Loopback is not authenticated proxy identity: untrusted local processes must not share this trust boundary. Missing or failed peer lookup, other peers, unsupported schemes, ambiguous comma-separated values, and invalid authorities fall back to the request URL origin. URL parsing validates ports and canonicalizes host case and default ports. IPv6 forwarded authorities remain unsupported.

## Standalone verification

```sh
bun test src/http/publicOrigin.forwarded.test.ts
```

These tests invoke the existing origin resolver directly and require no new middleware or guard. They cover all three trusted loopback forms, ws/wss normalization, ordinary HTTP/HTTPS, spoofed metadata from other peers, unavailable peer lookup, invalid and ambiguous metadata, and port canonicalization. This change does not install an Origin guard, change authentication, alter listeners, or bypass any policy.

## Local integration context (not shipped by this change)

The motivating incident occurred on an instance with an additional, uncommitted security guard. Its public HTTPS WebSocket requests through local Traefik were rejected because `wss` fell back to the internal HTTP origin. That instance's guard and guard-dependent integration/security tests are separate changes, intentionally excluded here. The WS403 regression is therefore not claimed to reproduce on clean HEAD without that guard. Local authenticated live-view and guard integration checks are supplementary observations, not coverage supplied by this standalone commit.

Traefik forwarding scheme reference: https://github.com/traefik/traefik/blob/v3.6.25/pkg/middlewares/forwardedheaders/forwarded_header.go

For running instances, hot-load `http.publicOrigin` and validate its docs/types; no server or Chrome restart is required. Before applying elsewhere, verify the immediate peer and proxy header-rewriting policy. This commit does not deploy to other instances.
