# Links in the canvas: where a click opens

The canvas behaves like a browser beside the chat: a tab has an address and its own ◀ ▶ history, and
a link click either moves the tab, opens a new canvas tab, or opens a new browser tab. One table decides it,
in `src/canvas/$script_canvas.js` (`canvasTarget` + `howOpen`); the server checks every target again
(`POST /canvas/:id`, `canvas.show` / `canvas.navigate` and the kinds' `prepare`).

## What an address opens as

| address | canvas kind |
|---|---|
| `/rpc/<fn>?<json>` | `view` (the `@view` function at that address) |
| `/files/absolute/…`, `/files/embed/…`, `/files/remote/<host>/…` | file → `view` of `files.page` |
| `http(s)://` another site | `url` (a frame; see below for sites that forbid framing) |
| any other Hyper page (`/settings`, `/tasks/…`, raw media) | none → new browser tab |
| `#…`, `mailto:`, `javascript:`, `download` links | left to the browser |

## How a click opens it

| where | click | result |
|---|---|---|
| inside a tab | plain click on a `/rpc` or Files address | **this tab** moves there, one history step (◀ returns) |
| inside a tab | `data-canvas-open="replace"` | this tab moves there **without** a history step |
| inside a tab | Cmd/Ctrl click, middle click, `data-canvas-open="tab"` | **new canvas tab** (or the open tab with the same address); the current tab stays |
| inside a tab | plain click on another site | new canvas tab (a site is not this tab's kind of address) |
| inside a tab | `target="_blank"`, `data-canvas-open="browser"`, a Hyper page without a kind | **new browser tab** |
| inside a tab | Shift/Alt click | the browser's own behaviour |
| in the chat | plain click on an address with a kind | new canvas tab, or switches to the tab already showing it; never touches another tab's history |
| in the chat | modifier/middle click, `target="_blank"` | the browser's own behaviour |
| tab chrome | ↗ in the address bar | new browser tab |

A site that forbids framing (`X-Frame-Options`, CSP `frame-ancestors`) opens in a **new browser tab** instead
of a canvas tab with a notice, unless this browser has the Hyper canvas frames extension
(`<html data-hyper-frames>`): the page asks with `show.fallback = "browser"`, the server checks the headers and
answers `{ browser: url }` without opening a tab. To work in such a site together with the agent, the agent
opens `browser.live` (the shared Chrome).

## No history step

- A page changing only its own filter, sort or selection: a link with `data-canvas-open="replace"`, or a framed
  app (`rpc.frame`) posting `{ hyperCanvas: 1, type: "navigate", params, replace: true }`.
- `canvas.navigate({ itemId, url, replace: true })` from the agent.
- The agent showing the same address again (`canvas.show`) switches to that tab; it adds nothing.

## What the canvas cannot see

Inside a `url` tab the site follows its own links in its frame: another origin, so those steps are not in
the tab's history (the frame's own back/forward works through the browser). `browser.live` has Chrome's own
back/forward in its toolbar.

## For view authors

Write plain `<a href="/rpc/…">` links (`rpc.url` builds them) — no htmx attributes. Add
`data-canvas-open="replace"` for filters and tabs inside one page, `data-canvas-open="tab"` for "open beside",
`target="_blank"` for things that should leave Hyper.
