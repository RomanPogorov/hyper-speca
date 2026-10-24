// Ported from Speca (plugins/servers/assets/term.js) to Hyper: every place, "@mac" (this computer) included, is a
// shell on Hyper's side behind /speca/term/stream and /speca/term/input; xterm.js is loaded here, in order.
// The person's terminal in the browser (a canvas tab or a full-screen page, a phone included): xterm.js on screen, and
// one of two shells behind it. A server: output from /p/servers/term/stream (server-sent events), keystrokes to
// /p/servers/term/input; reattaching replays the session's recent output, so a dropped connection or a second device
// continues the same shell. "@mac", the person's own Mac: a shell of the Speca app (window.dhDesktop.term) — only
// in the app, and nothing of it passes through Speca's server. A command from a ▶ of the chat (DHTerm.run) is typed
// in as soon as the shell is there; a terminal without a place yet asks where, showing the command.
(function () {
  if (window.DHTerm) { window.DHTerm.scan(); return; }
  const BASE = "/speca/assets/term/";
  const loadJs = (src) => new Promise((ok, fail) => { const s = document.createElement("script"); s.src = BASE + src; s.onload = ok; s.onerror = fail; document.head.appendChild(s); });
  const ready = (async () => { if (!window.Terminal) await loadJs("xterm.js"); if (!window.FitAddon) await loadJs("addon-fit.js"); })();

  const MAC = "@mac";
  const b64 = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  const csrfOf = (el) => el.dataset.csrf || (() => { try { return JSON.parse(document.body.getAttribute("hx-headers") || "{}")["x-csrf"] || ""; } catch { return ""; } })();
  const post = (el, path, body) => fetch(`/speca/${path}`, { method: "POST", headers: { "content-type": "application/json", "x-csrf": csrfOf(el), "hx-request": "true" }, body: JSON.stringify(body) });
  const KEYS = { esc: "\x1b", tab: "\t", up: "\x1b[A", down: "\x1b[B", right: "\x1b[C", left: "\x1b[D", "c-c": "\x03", "c-d": "\x04" };
  const touch = matchMedia("(pointer: coarse)").matches;
  const D = null; // Hyper: this computer is a place on the server side like any other
  // a command a ▶ of the chat left for the terminal it opened (a minute at most)
  const PENDING = "dh-term-run";
  const takePending = () => {
    try { const p = JSON.parse(sessionStorage.getItem(PENDING) || "null"); sessionStorage.removeItem(PENDING); return p && Date.now() - p.at < 60_000 ? p.cmd : null; } catch { return null; }
  };
  const asTyped = (cmd) => `${cmd.replace(/\r?\n/g, "\r").replace(/\r+$/, "")}\r`;

  function start(el) {
    if (el.dataset.ready) return;
    el.dataset.ready = "1";
    const i18n = JSON.parse(el.querySelector(".sterm-i18n").textContent);
    const screen = el.querySelector(".sterm-screen"), over = el.querySelector(".sterm-over"), msg = el.querySelector(".sterm-msg");
    const stateEl = el.querySelector(".sterm-state"), ctrlKey = el.querySelector('[data-key="ctrl"]');
    let server = el.dataset.server, term = null, fit = null, es = null, ctrl = false, queue = "", flushT = null, sizeT = null, closed = false;
    let pending = el.dataset.tab ? takePending() : null, offData = null, offExit = null;
    const local = () => false;

    const setState = (state, why) => {
      el.dataset.state = state;
      stateEl.textContent = state === "connecting" ? i18n.connecting : state === "closed" ? i18n.closed : "";
      if (state === "closed") { msg.textContent = (why && i18n.why[why]) || why || ""; over.hidden = false; }
      else over.hidden = true;
      if (state === "open" && pending) { const c = pending; pending = null; runNow(c); }
    };

    const send = (d) => {
      if (local()) { D?.write(MAC, d); return; }
      queue += d;
      flushT ??= setTimeout(() => { const d2 = queue; queue = ""; flushT = null; post(el, "term/input", { s: server, d: d2 }).catch(() => {}); }, 12);
    };
    const runNow = (cmd) => { if (local()) D?.run(MAC, cmd); else send(asTyped(cmd)); if (!touch) term?.focus(); };
    const sendSize = () => {
      if (!term) return;
      try { fit.fit(); } catch { /* hidden */ }
      clearTimeout(sizeT);
      sizeT = setTimeout(() => { if (local()) D?.resize(MAC, term.cols, term.rows); else post(el, "term/input", { s: server, cols: term.cols, rows: term.rows }).catch(() => {}); }, 120);
    };

    async function connectMac() {
      if (!D) { closed = true; setState("closed", "app_only"); return; }
      setState("connecting");
      offData ??= D.onData((key, data) => { if (key === MAC && local() && term) term.write(data); });
      offExit ??= D.onExit((key) => { if (key === MAC && local()) { closed = true; setState("closed", "exit"); } });
      const r = await D.open(MAC, term.cols, term.rows);
      if (!r) { closed = true; setState("closed", "app_only"); return; }
      term.reset(); if (r.replay) term.write(r.replay);
      setState("open"); sendSize(); if (!touch) term.focus();
    }

    function connect() {
      closed = false;
      if (local()) return void connectMac();
      es?.close();
      setState("connecting");
      const q = new URLSearchParams({ s: server, cols: String(term.cols), rows: String(term.rows) });
      es = new EventSource(`/speca/term/stream?${q}`);
      es.addEventListener("replay", (e) => { term.reset(); if (e.data) term.write(b64(e.data)); });
      es.addEventListener("data", (e) => term.write(b64(e.data)));
      es.addEventListener("status", (e) => {
        const s = JSON.parse(e.data);
        setState(s.state, s.message);
        if (s.state === "open") { sendSize(); if (!touch) term.focus(); }
        if (s.state === "closed") { closed = true; es.close(); }
      });
      // a dropped connection: EventSource reconnects by itself and the server replays the output
      es.onerror = () => { if (!closed) setState("connecting"); };
    }

    function boot() {
      screen.hidden = false;
      el.querySelector(".sterm-keys").hidden = false;
      el.querySelectorAll("[data-act]").forEach((a) => (a.hidden = false));
      if (server === MAC) el.querySelector(".sterm-name").textContent = el.dataset.macName || "Mac";
      term = new window.Terminal({
        cursorBlink: true, scrollback: 5000, fontSize: touch ? 13 : 14, allowProposedApi: false, macOptionIsMeta: true,
        fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
        // GitHub Dark Default (mbadolato/iTerm2-Color-Schemes): sixteen colours tuned to be read on a dark screen
        theme: {
          background: "#0f1115", foreground: "#e6edf3", cursor: "#58a6ff", cursorAccent: "#0f1115", selectionBackground: "#264f78", selectionForeground: "#ffffff",
          black: "#484f58", red: "#ff7b72", green: "#3fb950", yellow: "#d29922", blue: "#58a6ff", magenta: "#bc8cff", cyan: "#39c5cf", white: "#b1bac4",
          brightBlack: "#8b949e", brightRed: "#ffa198", brightGreen: "#56d364", brightYellow: "#e3b341", brightBlue: "#79c0ff", brightMagenta: "#d2a8ff", brightCyan: "#56d4dd", brightWhite: "#ffffff",
        },
        // grey and dimmed text (Claude Code's hints, a prompt's suggestion) is lifted until it can be read: 4.5:1, as for the UI
        minimumContrastRatio: 4.5,
      });
      fit = new window.FitAddon.FitAddon();
      term.loadAddon(fit);
      term.open(screen);
      try { fit.fit(); } catch { /* not laid out yet */ }
      term.onData((d) => {
        if (ctrl && d.length === 1) { const c = d.toUpperCase().charCodeAt(0); if (c >= 64 && c <= 95) d = String.fromCharCode(c - 64); setCtrl(false); }
        send(d);
      });
      new ResizeObserver(() => sendSize()).observe(screen);
      if (window.visualViewport && el.classList.contains("sterm-full")) {
        // the phone keyboard takes part of the screen: keep the prompt and the key row above it
        const fitPage = () => { el.style.height = `${window.visualViewport.height}px`; window.scrollTo(0, 0); };
        window.visualViewport.addEventListener("resize", fitPage); fitPage();
      }
      connect();
    }

    const setCtrl = (on) => { ctrl = on; ctrlKey.setAttribute("aria-pressed", String(on)); };
    const choose = (name) => {
      server = name; el.dataset.server = server;
      el.querySelector(".sterm-name").textContent = server === MAC ? el.dataset.macName || "Mac" : server;
      const full = el.querySelector('[data-act="full"]'); if (full) full.href = `/speca/term?s=${encodeURIComponent(server)}`;
      el.querySelector(".sterm-pick").hidden = true;
      if (el.dataset.tab) post(el, "term/pick", { tab: el.dataset.tab, s: server }).catch(() => {});
      boot();
    };

    el.addEventListener("click", async (e) => {
      const k = e.target.closest("[data-key]");
      if (k && term) {
        e.preventDefault();
        const key = k.dataset.key;
        if (key === "ctrl") setCtrl(!ctrl);
        else if (key === "paste") { try { const t = await navigator.clipboard.readText(); if (t) send(t); } catch { /* not allowed */ } }
        else send(KEYS[key] ?? key);
        if (!touch) term.focus();
        return;
      }
      const pick = e.target.closest("[data-pick]");
      if (pick) { choose(pick.dataset.pick); return; }
      if (e.target.closest(".sterm-again")) { connect(); return; }
      const end = e.target.closest('[data-act="end"]');
      if (end && confirm(local() ? end.dataset.askMac : end.dataset.ask)) {
        if (local()) await D?.close(MAC); else await post(el, "term/close", { s: server }).catch(() => {});
        return;
      }
      if (e.target.closest(".sterm-screen") && term) term.focus();
    });
    // keys on the row must not take the focus away from the terminal (the phone keyboard would close)
    el.addEventListener("mousedown", (e) => { if (e.target.closest(".sterm-key")) e.preventDefault(); });

    // a command from the chat's ▶: typed in once the shell is there; no place chosen yet → the choice shows it
    const showPending = () => {
      const will = el.querySelector(".sterm-will");
      if (!will) return;
      will.hidden = !pending; will.querySelector("b").textContent = pending ?? "";
    };
    el._dhRun = (cmd) => {
      if (server && el.dataset.state === "open") return runNow(cmd);
      pending = cmd;
      if (!server) { showPending(); autoPick(); }
    };

    // the tab was closed or replaced: stop watching (the session itself stays for its idle time)
    const gone = setInterval(() => { if (!el.isConnected) { clearInterval(gone); es?.close(); offData?.(); offExit?.(); term?.dispose(); } }, 2000);

    // the Mac is a place only inside the app; with a single place and a command waiting, no need to ask
    const macBtn = el.querySelector(".sterm-mac");
    const places = () => [...el.querySelectorAll(".sterm-srv[data-pick]")].filter((b) => !b.hidden);
    const autoPick = () => { const p = places(); if (pending && p.length === 1) choose(p[0].dataset.pick); };
    if (server) boot();
    else { showPending(); autoPick(); }
  }

  function scan() { ready.then(() => document.querySelectorAll(".sterm:not([data-ready])").forEach(start)); }
  /** Runs a command in a terminal on the page (the chat's ▶). */
  const run = (el, cmd) => ready.then(() => { if (!el.dataset.ready) start(el); el._dhRun?.(cmd); });
  window.DHTerm = { scan, run, PENDING };
  const go = () => { scan(); new MutationObserver(() => scan()).observe(document.body, { childList: true, subtree: true }); };
  if (document.body) go(); else document.addEventListener("DOMContentLoaded", go, { once: true });
})();
