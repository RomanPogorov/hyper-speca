// Speca browser glue. Server templates are the only source of markup; this file handles only transient UX:
// live regions over SSE, chat tail + scroll anchoring, composer keys, dialogs, toasts, layout, tooltips.
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const root = document.documentElement;
  const csrf = () => { try { return JSON.parse(document.body.getAttribute("hx-headers") || "{}")["x-csrf"] || ""; } catch { return ""; } };
  const post = (url, data = {}) => fetch(url, { method: "POST", headers: { "x-csrf": csrf(), "hx-request": "true", "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(data) });

  // ── theme (Basecoat uses .dark; the prototype tokens use data-theme) ──
  const darkMQ = matchMedia("(prefers-color-scheme: dark)");
  function syncDark() {
    const t = root.getAttribute("data-theme") || localStorage.getItem("dh-theme");
    if (t && !root.getAttribute("data-theme")) root.setAttribute("data-theme", t);
    root.classList.toggle("dark", (root.getAttribute("data-theme") || (darkMQ.matches ? "dark" : "light")) === "dark");
  }
  syncDark();
  darkMQ.addEventListener("change", syncDark);

  // ── toasts ──
  window.dhToast = (...a) => toast(...a);

  // ── styles edited while the page is open: every htmx answer says the stylesheets' versions; a newer one is loaded
  // next to the old and the old removed once it applies (no flash), so new markup never meets old styles ──
  document.addEventListener("htmx:afterRequest", (e) => {
    const h = e.detail.xhr?.getResponseHeader("x-dh-css"); if (!h) return;
    for (const pair of h.split(",")) {
      const [file, v] = pair.split("=");
      const link = document.querySelector(`link[rel="stylesheet"][href^="/speca/assets/${file}?"]`);
      if (!link || link.dataset.next || new URL(link.href).searchParams.get("v") === v) continue;
      const next = link.cloneNode(); next.href = `/speca/assets/${file}?v=${v}`; link.dataset.next = "1";
      next.onload = () => link.remove(); next.onerror = () => { delete link.dataset.next; next.remove(); };
      link.after(next);
    }
  });
  // ▶ of a shell block in the chat: the command runs in the person's terminal canvas (servers plugin: their Mac in the
  // app, or a server of theirs) — the one open in this chat, else its tab, else a new one that asks where
  async function runInTerminal(cmd) {
    const ru = document.documentElement.lang === "ru";
    const open = document.querySelector(".sterm[data-tab]");
    if (open && window.DHTerm) { window.DHTerm.run(open, cmd); return; }
    const sid = document.querySelector("#log[data-session]")?.dataset.session;
    if (!sid) { toast(ru ? "Откройте чат, чтобы выполнить команду" : "Open a chat to run the command", "", "error"); return; }
    sessionStorage.setItem("dh-term-run", JSON.stringify({ cmd, at: Date.now() }));
    const tab = document.querySelector('#tabs .tab[data-kind="servers.terminal"]');
    if (tab) { tab.click(); return; }
    const r = await post(`/speca/s/${sid}/canvas`, { kind: "servers.terminal" }).catch(() => null);
    if (!r?.ok) { sessionStorage.removeItem("dh-term-run"); toast(ru ? "Терминал недоступен: включите «Серверы (SSH)» в Подключениях" : "No terminal: turn on “Servers (SSH)” in Connections", "", "error"); return; }
    document.dispatchEvent(new CustomEvent("dh-canvas"));
  }
  function toast(title, description = "", category = "success") {
    const t = $("#toaster");
    if (t && t.toast) t.toast({ category, title, description });
    else if (t) { const d = document.createElement("div"); d.className = "toast-lite"; d.textContent = title + (description ? " — " + description : ""); t.appendChild(d); setTimeout(() => d.remove(), 4000); }
  }
  document.addEventListener("dh-toast", (e) => toast(e.detail.title, e.detail.description, e.detail.category));
  document.addEventListener("dh-reload", () => location.reload());
  document.addEventListener("dh-close-dialog", () => $("#dlg")?.close());
  // a button that started something is busy until it is answered (the kit's aria-busy look): a form sent the usual
  // way — until the next page; an htmx request — until its answer. A second press does nothing meanwhile.
  const setBusy = (b, on) => { if (!b?.classList?.contains("btn")) return; if (on) { b.setAttribute("aria-busy", "true"); clearTimeout(b._busyT); b._busyT = setTimeout(() => b.removeAttribute("aria-busy"), 60_000); } else { clearTimeout(b._busyT); b.removeAttribute("aria-busy"); } };
  document.addEventListener("submit", (e) => {
    if (e.defaultPrevented) return;   // htmx forms: below
    const b = e.submitter ?? e.target.querySelector?.('button[type="submit"]');
    if (b?.getAttribute("aria-busy") === "true") { e.preventDefault(); return; }
    setBusy(b, true);
  });
  addEventListener("pageshow", (e) => { if (e.persisted) $$('.btn[aria-busy="true"]').forEach((b) => setBusy(b, false)); });
  document.addEventListener("htmx:beforeSend", (e) => {
    const elt = e.detail.elt;
    const b = elt?.classList?.contains("btn") ? elt : elt?.tagName === "FORM" ? (e.detail.requestConfig?.triggeringEvent?.submitter ?? elt.querySelector('button[type="submit"]')) : null;
    if (b) { setBusy(b, true); elt._busyBtn = b; }
  });
  document.addEventListener("htmx:afterRequest", (e) => { const elt = e.detail.elt; if (elt?._busyBtn) { setBusy(elt._busyBtn, false); elt._busyBtn = null; } });
  // the sidebar keeps its scroll: across a move to another chat (a new page) and across its own live refresh; the open
  // chat stays in view
  const SB = ["#sbList", ".sb-rail-wrap"];
  const sbPos = () => Object.fromEntries(SB.map((k) => [k, $(k)?.scrollTop ?? 0]));
  const sbSet = (pos) => { for (const k of SB) { const el = $(k); if (el && pos?.[k] != null) el.scrollTop = pos[k]; } };
  const sbShowCurrent = () => {
    for (const k of SB) {
      const box = $(k), cur = box?.querySelector('[aria-current="true"], .rs.on');
      if (!box || !cur || !box.offsetParent) continue;
      const b = box.getBoundingClientRect(), r = cur.getBoundingClientRect();
      if (r.top < b.top || r.bottom > b.bottom) box.scrollTop += r.top < b.top ? r.top - b.top - 8 : r.bottom - b.bottom + 8;
    }
  };
  addEventListener("pagehide", () => sessionStorage.setItem("dh-sb-scroll", JSON.stringify(sbPos())));
  let sbKeep = null;
  document.addEventListener("htmx:beforeSwap", (e) => { if (e.detail.target?.id === "sb-inner") sbKeep = sbPos(); });
  // the agent's activity line (polled every 2 s while it works): changed in place, not drawn anew — the spinner keeps
  // turning and nothing moves when only the seconds change; nothing at all when nothing changed
  document.addEventListener("htmx:beforeSwap", (e) => {
    const el = e.detail.target;
    if (!el?.matches?.(".e.live") || e.detail.xhr?.status !== 200) return;
    const tpl = document.createElement("template"); tpl.innerHTML = e.detail.serverResponse;
    const now = [...el.childNodes], next = [...tpl.content.childNodes];
    const same = (a, b) => a.nodeType === b.nodeType && (a.nodeType !== 1 || (a.tagName === b.tagName && a.className === b.className));
    if (now.length !== next.length || !now.every((n, i) => same(n, next[i]))) return;   // another shape: the usual swap
    e.detail.shouldSwap = false;
    now.forEach((n, i) => {
      const m = next[i];
      if (n.nodeType !== 1) { if (n.textContent !== m.textContent) n.textContent = m.textContent; return; }
      if (n.outerHTML === m.outerHTML) return;
      if (!n.children.length && !m.children.length) n.textContent = m.textContent; else { n.replaceWith(m); htmx.process(m); }
    });
  });
  document.addEventListener("htmx:afterSwap", () => { if (sbKeep) { sbSet(sbKeep); sbKeep = null; } });
  // the person opened something on the canvas: on a phone, go there
  const toCanvasM = () => { if (matchMedia("(max-width: 820px)").matches && $("#app")?.dataset.chat !== "none") $('[data-act=mview][data-v=canvas]')?.click(); };
  document.addEventListener("dh-canvas", toCanvasM);
  // a menu that would run past the screen's edge (a phone) is moved back in
  document.addEventListener("click", () => setTimeout(() => $$('[data-popover][aria-hidden="false"]').forEach((p) => {
    p.style.translate = "";
    // by the layout, not the rectangle: the menu is still scaling in as it opens
    const c = p.offsetParent?.getBoundingClientRect(); if (!c) return;
    const left = c.left + p.offsetLeft, over = left + p.offsetWidth - (innerWidth - 8), under = 8 - left;
    if (over > 0) p.style.translate = `${-Math.min(over, left - 8)}px 0`; else if (under > 0) p.style.translate = `${under}px 0`;
  })));
  // ── folded projects and folders: kept on this device (a cookie the server reads, so a live refresh keeps them) ──
  function saveFolded() {
    const ids = [...$$(".proj[data-open=false][data-pid]")].map((p) => p.dataset.pid).concat([...$$(".folder[data-open=false][data-fid]")].map((f) => f.dataset.fid));
    document.cookie = `dh_sb_closed=${encodeURIComponent(ids.join(","))}; path=/; max-age=31536000; samesite=lax`;
    syncFoldBtn();
  }
  // the "fold all" button: folds every project while any is open, else unfolds them all
  function syncFoldBtn() {
    const b = $("[data-act=projects-fold]"); if (!b) return;
    const anyOpen = !!$(".proj[data-open=true]");
    b.dataset.state = anyOpen ? "fold" : "unfold";
    const label = anyOpen ? b.dataset.fold : b.dataset.unfold;
    b.setAttribute("aria-label", label); b.dataset.tooltip = label;
  }
  function foldProjects(force) {
    const open = force === undefined ? !$(".proj[data-open=true]") : !force;
    $$(".proj[data-pid]").forEach((p) => { p.dataset.open = String(open); p.querySelector("[data-act=proj-toggle]")?.setAttribute("aria-expanded", String(open)); });
    saveFolded();
  }
  document.addEventListener("htmx:afterSwap", (e) => { if (e.detail.target?.id === "sb-inner" || e.detail.elt?.id === "sb-inner") syncFoldBtn(); });
  addEventListener("DOMContentLoaded", syncFoldBtn);

  // ── the command palette (⌘K / Ctrl K): find anything — chats (by words, then by meaning), projects, canvases, files,
  // colleagues — or run a command; arrows move, Enter opens, Esc closes. The design system's menu list in a dialog. ──
  let palEl = null, palSeq = 0, palT = 0, palItems = [], palHl = -1;
  function closePalette() { if (!palEl) return; const d = palEl; palEl = null; if (d.open) d.close(); d.remove(); }
  function openPalette() {
    if (palEl) { palEl.querySelector("input")?.focus(); return; }
    const L = JSON.parse(document.body.dataset.pal || "{}");
    const d = document.createElement("dialog"); d.className = "pal"; d.setAttribute("aria-label", L.title || "");
    d.innerHTML = `<div class="menu pal-menu"><label class="menu-q">${L.qicon || ""}<input type="text" role="combobox" aria-expanded="true" aria-controls="pal-list" placeholder="${escHtml(L.ph || "")}" autocomplete="off" spellcheck="false"><kbd class="pal-k">esc</kbd></label><div class="menu-list pal-list" id="pal-list" role="listbox"></div><div class="pal-foot"><span><kbd class="pal-k">↑</kbd><kbd class="pal-k">↓</kbd>${escHtml(L.move || "")}</span><span><kbd class="pal-k">↵</kbd>${escHtml(L.open || "")}</span><span><kbd class="pal-k">esc</kbd>${escHtml(L.close || "")}</span></div></div>`;
    document.body.append(d); palEl = d; d.showModal();
    const input = d.querySelector("input"), list = d.querySelector(".pal-list");
    input.focus();
    d.addEventListener("close", () => { if (palEl === d) { palEl = null; d.remove(); } });
    d.addEventListener("click", (e) => { if (e.target === d) closePalette(); });
    input.addEventListener("input", () => { clearTimeout(palT); palT = setTimeout(() => palLoad(input.value), 110); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); palMove(e.key === "ArrowDown" ? 1 : -1); }
      else if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); const it = palItems[palHl]; if (it) palRun(it); }
    });
    list.addEventListener("mousemove", (e) => { const r = e.target.closest(".menu-i[data-i]"); if (r && +r.dataset.i !== palHl) palMark(+r.dataset.i, false); });
    list.addEventListener("click", (e) => { const r = e.target.closest(".menu-i[data-i]"); if (r) { e.preventDefault(); palRun(palItems[+r.dataset.i]); } });
    palLoad("");
  }
  function palMark(i, scroll = true) {
    palHl = i;
    palEl?.querySelectorAll(".pal-list .menu-i").forEach((r) => { const on = +r.dataset.i === i; r.classList.toggle("hl", on); r.setAttribute("aria-selected", String(on)); if (on && scroll) r.scrollIntoView({ block: "nearest" }); });
  }
  function palMove(d) { if (!palItems.length) return; palMark((palHl + d + palItems.length) % palItems.length); }
  function palDraw(groups, append) {
    const list = palEl?.querySelector(".pal-list"); if (!list) return;
    const L = JSON.parse(document.body.dataset.pal || "{}");
    if (!append) { list.innerHTML = ""; palItems = []; }
    for (const g of groups) {
      const h = document.createElement("div"); h.className = "menu-h"; h.textContent = g.title; list.append(h);
      for (const it of g.items) {
        const i = palItems.push(it) - 1;
        const r = document.createElement(it.href ? "a" : "div"); r.className = "menu-i"; r.dataset.i = String(i); r.setAttribute("role", "option");
        if (it.href) r.href = it.href;
        r.innerHTML = `${it.icon || ""}<span class="menu-t"><b>${escHtml(it.title || "")}</b>${it.sub ? `<small>${escHtml(it.sub)}</small>` : ""}</span>${it.keys ? `<span class="menu-k">${escHtml(it.keys)}</span>` : ""}`;
        list.append(r);
      }
    }
    if (!palItems.length) list.innerHTML = `<div class="menu-none">${escHtml(L.none || "")}</div>`;
    if (!append || palHl < 0) palMark(palItems.length ? 0 : -1);
  }
  async function palLoad(q) {
    const n = ++palSeq, sid = (location.pathname.match(/^\/speca\/s\/([\w-]+)/) || [])[1] || "";
    const r = await fetch(`/speca/f/palette?q=${encodeURIComponent(q)}&s=${encodeURIComponent(sid)}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    if (n !== palSeq || !r) return;
    palDraw(r.groups || [], false);
    // by meaning, a moment later, below the word matches
    if (q.trim().length >= 3) {
      const skip = palItems.map((x) => (x.href || "").match(/^\/speca\/s\/([\w-]+)/)?.[1]).filter(Boolean).join(",");
      const m = await fetch(`/speca/f/palette/meaning?q=${encodeURIComponent(q)}&skip=${encodeURIComponent(skip)}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (n === palSeq && m?.groups?.length) palDraw(m.groups, true);
    }
  }
  function palRun(it) {
    if (!it) return;
    closePalette();
    if (it.href) { location.href = it.href; return; }
    if (it.post) { htmx.ajax("POST", it.post, { values: it.vals || {}, swap: "none" }); return; }
    if (it.dialog) { openDialog(it.dialog); return; }
    if (it.act === "projects-collapse") { foldProjects(true); return; }
    // the app's own commands: what their buttons do
    const b = document.createElement("button"); b.type = "button"; b.hidden = true; b.dataset.act = it.act === "sidebar" ? "sb-toggle" : it.act; document.body.append(b); b.click(); b.remove();
  }

  function openDialog(url) {
    htmx.ajax("GET", url, { target: "#dlg-body", swap: "innerHTML" }).then(() => {
      const d = $("#dlg");
      if (d.open) return;
      d.showModal();
      // focus goes to the first field, not to ✕ in the header (docs/DESIGN.md §3 Dialog)
      if (!d.querySelector("[autofocus]")) d.querySelector(".dlg-body :is(input:not([type=hidden]):not([readonly]), select, textarea)")?.focus();
    });
  }
  window.addEventListener("load", () => {
    const u = new URL(location.href);
    // ?dialog=/p/<plugin>/<path>: a plugin's dialog to open over this page (a sign-in started from a full page link)
    const dlg = u.searchParams.get("dialog");
    if (dlg !== null) {
      if (/^\/p\/[\w-]+\/[\w\/-]*$/.test(dlg)) openDialog(dlg);
      u.searchParams.delete("dialog");
      history.replaceState(null, "", u.pathname + (u.search || "") + u.hash);
    }
    const msg = u.searchParams.get("toast"), err = u.searchParams.get("error");
    if (msg || err) {
      setTimeout(() => toast(msg || err, "", err ? "error" : "success"), 300);
      u.searchParams.delete("toast"); u.searchParams.delete("error");
      history.replaceState(null, "", u.pathname + (u.search || "") + u.hash);
    }
  });

  // ── live regions: one SSE stream per tab, invalidation only ──
  let es = null, topicsKey = "", reconnectT = null;
  const pending = new Map();
  function regionTopics() {
    const set = new Set();
    $$("[data-live-topic]").forEach((el) => el.dataset.liveTopic.split(/\s+/).filter(Boolean).forEach((t) => set.add(t)));
    $$("#log[data-session]").forEach((el) => set.add("session:" + el.dataset.session));
    return [...set].sort();
  }
  function connect() {
    if (document.hidden) return;
    const topics = regionTopics();
    const key = topics.join(",");
    if (es && key === topicsKey) return;
    if (es) es.close();
    topicsKey = key;
    if (!topics.length) return;
    es = new EventSource("/speca/events?topics=" + encodeURIComponent(key));
    es.addEventListener("live", (e) => signal(e.data));
    // after a dropped connection (server restart, sleep, network) signals may have been missed: re-fetch everything
    let opened = false;
    es.addEventListener("open", () => { if (opened) regionTopics().forEach(signal); opened = true; });
  }
  // a live refresh already on its way when the person opened a version: its answer does not replace that view either
  document.addEventListener("htmx:beforeSwap", (e) => {
    const tgt = e.detail.target;
    if (tgt?.id === "canvas-in" && e.detail.requestConfig?.triggeringEvent?.type === "dh-live" && tgt.querySelector("#cbody .ver-banner")) e.detail.shouldSwap = false;
  });
  // nor does it close a menu the person has open (the git menu on the branch chip, the run menu); the next one will do
  document.addEventListener("htmx:beforeRequest", (e) => {
    if (e.detail.requestConfig?.triggeringEvent?.type === "dh-live" && e.detail.elt.querySelector?.('.dropdown-menu [aria-expanded="true"], [aria-expanded="true"][aria-haspopup="menu"]')) e.preventDefault();
  });
  function scheduleConnect() { clearTimeout(reconnectT); reconnectT = setTimeout(connect, 150); }
  function signal(topic) {
    $$("[data-live-topic]").forEach((el) => {
      if (!el.dataset.liveTopic.split(/\s+/).includes(topic)) return;
      // looking at a version, a moment of the journal or a comparison: a live refresh would throw the person back to
      // the draft — the banner there offers the way back instead
      if (el.id === "canvas-in" && el.querySelector("#cbody .ver-banner")) return;
      clearTimeout(pending.get(el));
      pending.set(el, setTimeout(() => { if (el.isConnected) htmx.trigger(el, "dh-live"); }, 100));
    });
    const log = $("#log[data-session]");
    if (log && topic === "session:" + log.dataset.session) refreshLog();
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { es?.close(); es = null; topicsKey = ""; }
    else { connect(); regionTopics().forEach(signal); }
  });

  // ── chat log tail ──
  let logBusy = false, logAgain = false;
  function nearBottom(el) { return el.scrollHeight - el.scrollTop - el.clientHeight < 80; }
  function refreshLog() {
    const log = $("#log[data-session]");
    if (!log) return;
    if (logBusy) { logAgain = true; return; }
    logBusy = true;
    const stick = nearBottom(log);
    const after = $("#log-mark")?.dataset.after ?? "-1";
    const inner = $("#log-inner");
    const empty = inner && inner.querySelector(".empty-chat");
    htmx.ajax("GET", `/speca/s/${log.dataset.session}/log?after=${empty ? -1 : after}`, { target: "#log-inner", swap: empty ? "innerHTML" : "beforeend" }).finally(() => {
      logBusy = false;
      restoreOpen(); syncBusy();
      if (stick) log.scrollTop = log.scrollHeight;
      watchOlder();
      if (logAgain) { logAgain = false; refreshLog(); }
    });
  }
  // right after opening a chat, parts that load late (cards, images) must not leave it above the end — unless the
  // person scrolls up themselves
  function stickToBottom() {
    const log = $("#log"), inner = $("#log-inner"); if (!log || !inner || !window.ResizeObserver) return;
    let moved = false, last = log.scrollTop;
    const off = () => { moved = true; };
    log.addEventListener("wheel", off, { once: true, passive: true }); log.addEventListener("touchmove", off, { once: true, passive: true });
    // any way up counts (keys, the scrollbar, a jump to an older message), and older turns coming in
    const up = () => { if (log.scrollTop < last - 2) moved = true; last = log.scrollTop; };
    log.addEventListener("scroll", up, { passive: true });
    const ro = new ResizeObserver(() => { if (!moved && !log.dataset.older) { scrollLogBottom(true); last = log.scrollTop; } });
    ro.observe(inner);
    setTimeout(() => ro.disconnect(), 4000);
  }
  function scrollLogBottom(instant = false) {
    const log = $("#log"); if (!log) return;
    if (instant) { log.style.scrollBehavior = "auto"; log.scrollTop = log.scrollHeight; requestAnimationFrame(() => { log.style.scrollBehavior = ""; }); }
    else log.scrollTop = log.scrollHeight;
  }

  // older turns: a chat opens on its last ones; the mark at the top loads the page before it when it comes within
  // 750 px (as Telegram does), and what the person is reading stays where it is
  let olderIO = null;
  function watchOlder() {
    const log = $("#log"); if (!log || !window.IntersectionObserver) return;
    if (!olderIO || olderIO.root !== log) { olderIO?.disconnect(); olderIO = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) loadOlder(e.target); }), { root: log, rootMargin: "750px 0px 0px 0px" }); }
    $$("#log .log-more:not([data-watched])").forEach((m) => { m.dataset.watched = "1"; olderIO.observe(m); });
  }
  async function loadOlder(mark) {
    if (!mark?.isConnected || mark.dataset.busy) return false;
    mark.dataset.busy = "1"; olderIO?.unobserve(mark);
    const log = $("#log"); log.dataset.older = "1";
    const ref = mark.nextElementSibling, top = ref?.getBoundingClientRect().top ?? 0;
    const r = await fetch(mark.dataset.src, { headers: { "hx-request": "true" } }).catch(() => null);
    if (!r?.ok || !mark.isConnected) { delete mark.dataset.busy; setTimeout(() => { if (mark.isConnected) olderIO?.observe(mark); }, 3000); return false; }
    const tpl = document.createElement("template"); tpl.innerHTML = await r.text();
    const nodes = [...tpl.content.children];
    // the browser's own scroll anchoring (not in every Safari) would make up for it a second time
    log.style.overflowAnchor = "none";
    mark.replaceWith(tpl.content);
    nodes.forEach((n) => htmx.process(n));
    // at once, not the log's smooth scroll: the jump is what is made up for
    if (ref?.isConnected) { log.style.scrollBehavior = "auto"; log.scrollTop += ref.getBoundingClientRect().top - top; log.style.scrollBehavior = ""; }
    requestAnimationFrame(() => { log.style.overflowAnchor = ""; });
    restoreOpen(); watchOlder();
    return true;
  }

  // remember which work-log groups the person opened
  const opened = new Set(JSON.parse(sessionStorage.getItem("dh-open") || "[]"));
  function restoreOpen() { opened.forEach((id) => { const el = document.getElementById(id); if (el) { el.dataset.open = "true"; el.querySelector(".tools-h")?.setAttribute("aria-expanded", "true"); const l = el.querySelector(".tools-list[hx-get]"); if (l) htmx.trigger(l, "dh-open"); } }); }

  // ── composer ──
  function autosize(t) { if (!t) return; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 180) + "px"; }
  let staleAt = 0;
  function syncBusy() {
    const head = $("#chat-head"), form = $("#composer");
    if (!head || !form) return;
    const headBusy = !!head.querySelector(".st-running, .st-waiting");
    const logOpen = !!$("#log .turn[data-open=true]");
    // the head says the agent is not working, but the log still shows "thinking": the log missed an update
    if (!headBusy && logOpen && Date.now() - staleAt > 5000) { staleAt = Date.now(); refreshLog(); }
    // whenever anything looks like work, Stop is there — on the server it also unsticks a hung turn
    const busy = headBusy || logOpen;
    const btn = form.querySelector("#send");
    if (btn) {
      btn.dataset.busy = String(busy);
      btn.setAttribute("aria-label", busy ? (btn.dataset.stopLabel || "Stop") : (btn.dataset.sendLabel || "Send"));
    }
    form.dataset.busy = String(busy);
  }
  let escAt = 0;
  document.addEventListener("keydown", (e) => {
    const t = e.target;
    if (t && t.id === "cin") {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        const form = t.closest("form");
        // like Claude Code: a message sent while the agent works joins at its next step; Ctrl/⌘+Enter waits for the turn's end
        form.querySelector("[name=delivery]").value = (e.metaKey || e.ctrlKey) ? "queue" : "steer";
        if (t.value.trim() || form.querySelector("input[name=att]")) htmx.trigger(form, "submit");
        return;
      }
    }
    if (e.key === "Escape") {
      const now = Date.now();
      const form = $("#composer");
      if (form && form.dataset.busy === "true" && now - escAt < 500 && !$("#dlg[open]")) post(`/speca/s/${form.dataset.session}/stop`);
      escAt = now;
    }
    // approval cards: Enter approves, Esc rejects — only when the card itself has focus
    const card = document.activeElement?.closest?.("[data-approval]");
    if (card && document.activeElement === card) {
      if (e.key === "Enter") { e.preventDefault(); card.querySelector("[data-key=enter]")?.click(); }
      if (e.key === "Escape") { e.preventDefault(); card.querySelector("[data-key=esc]")?.click(); }
    }
    // layout keys
    if ((e.ctrlKey || e.metaKey) && e.key === ".") { e.preventDefault(); toggleSide(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") { e.preventDefault(); toggleSb(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); palEl ? closePalette() : openPalette(); }
    // screen views: ⌘1–6 (Ctrl on Windows/Linux); Alt still works
    if (((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey || e.altKey && !e.metaKey && !e.ctrlKey) && /^[1-6]$/.test(e.key)) { e.preventDefault(); setView(VIEW_KEYS[+e.key - 1]); }
    // the quick chat over the canvas: ⌘J (Ctrl+J) shows and hides it; elsewhere ⌘J goes to the composer
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "j") { e.preventDefault(); popKey(); }
    // Esc hides the quick chat first; then, in the full-screen canvas, leaves it (when nothing else on screen wants the Esc)
    const calm = !$("#dlg[open]") && !document.querySelector(".cm, .vmenu, .slash-pop:not([hidden])");
    if (e.key === "Escape" && calm && $("#app")?.dataset.pop === "open") chatPop(false);
    else if (e.key === "Escape" && calm && $("#app")?.dataset.view === "focus") leaveFocus();
    if (e.key === "F2" && $("#chat-head")) { e.preventDefault(); rename(); }
  });
  document.addEventListener("input", (e) => {
    if (e.target.id === "cin") autosize(e.target);
    if (e.target.id === "sbq") searchSidebar(e.target.value);
  });
  document.addEventListener("htmx:configRequest", (e) => {
    const form = e.detail.elt.closest?.("#composer");
    if (form && e.detail.elt === form) e.detail.parameters.key = Math.random().toString(36).slice(2, 12);
  });
  // a dialog form sends once: buttons wait while the request is in flight (no double submits)
  document.addEventListener("htmx:beforeRequest", (e) => {
    const f = e.detail.elt;
    if (!f.matches?.("#dlg form")) return;
    if (f.dataset.sending) { e.preventDefault(); return; }
    f.dataset.sending = "1"; f.querySelectorAll("button").forEach((b) => { b.disabled = true; });
  });
  // a level chosen in a menu shows on its button right away
  document.addEventListener("htmx:afterRequest", (e) => {
    const it = e.detail.elt;
    if (!e.detail.successful || !it.matches?.("[role=menuitemradio]")) return;
    const menu = it.closest(".dropdown-menu"), btn = menu?.querySelector("button[aria-haspopup]");
    menu?.querySelectorAll("[role=menuitemradio]").forEach((x) => x.setAttribute("aria-checked", String(x === it)));
    if (btn) { const ic = it.querySelector("svg"), label = it.querySelector("span")?.firstChild?.textContent; const bic = btn.querySelector("svg"); if (ic && bic) { const c = ic.cloneNode(true); c.setAttribute("class", bic.getAttribute("class")); bic.replaceWith(c); } const bl = btn.querySelector("span"); if (bl && label) bl.textContent = label; }
    menu?.querySelector("[data-popover]")?.setAttribute("aria-hidden", "true"); btn?.setAttribute("aria-expanded", "false");
  });
  document.addEventListener("htmx:afterRequest", (e) => {
    const f = e.detail.elt;
    if (f.matches?.("#dlg form")) { delete f.dataset.sending; f.querySelectorAll("button").forEach((b) => { b.disabled = false; }); }
  });
  // people picker filter
  document.addEventListener("input", (e) => {
    if (e.target.dataset?.act !== "pick-filter") return;
    const v = e.target.value.trim().toLowerCase();
    e.target.closest(".pick, .fgroup")?.querySelectorAll(".pick-row, .check-row").forEach((r) => { r.hidden = !!v && !r.textContent.toLowerCase().includes(v); });
  });
  document.addEventListener("htmx:afterRequest", (e) => {
    const elt = e.detail.elt;
    if (!e.detail.successful) return;
    if (elt.id === "composer") {
      const t = $("#cin"); if (t) { t.value = ""; autosize(t); t.focus(); }
      $$("#cchips .cchip.att").forEach((c) => c.remove());
      setTimeout(scrollLogBottom, 50);
    }
    if (elt.matches?.("form[data-reset]")) elt.reset();
    if (elt.closest?.("#dlg") && elt.matches?.("form") && (elt.getAttribute("hx-swap") === "none")) $("#dlg")?.close();
  });
  document.addEventListener("htmx:responseError", (e) => toast(e.detail.xhr.responseText?.slice(0, 200) || "Error", "", "error"));
  document.addEventListener("htmx:afterSwap", (e) => {
    if (e.detail.target?.id === "chat-head" || e.detail.elt?.id === "chat-head") syncBusy();
    restoreOpen();
    scheduleConnect();
  });
  document.addEventListener("htmx:oobAfterSwap", () => { restoreOpen(); syncBusy(); });
  if (!document.body.classList.contains("plain")) sessionStorage.setItem("dh-back", location.pathname + location.search);
  // the settings' back link leads to the page the person came from (a plain link: nothing to intercept)
  { const b = document.getElementById("set-back"), to = sessionStorage.getItem("dh-back"); if (b && to) b.setAttribute("href", to); }
  document.addEventListener("htmx:pushedIntoHistory", () => { if (!document.body.classList.contains("plain")) sessionStorage.setItem("dh-back", location.pathname + location.search); });
  // a run log follows its end
  document.addEventListener("htmx:afterSettle", () => { const l = $("#run-log"); if (l) l.scrollTop = l.scrollHeight; });

  // ── delegated clicks ──
  document.addEventListener("click", (e) => {
    const send = e.target.closest("#send");
    if (send && send.dataset.busy === "true") {
      const form = send.closest("form");
      if (!form.querySelector("#cin")?.value.trim()) { e.preventDefault(); post(`/speca/s/${form.dataset.session}/stop`); return; }
    }
    const a = e.target.closest("[data-act],[data-dialog],[data-href]");
    if (!a) return;
    if (a.dataset.href && !a.dataset.act) { location.href = a.dataset.href; return; }
    if (a.hasAttribute("data-dialog")) {
      e.preventDefault();
      $$("details.verpop[open]").forEach((d) => d.removeAttribute("open"));
      openDialog(a.dataset.dialog || a.getAttribute("href"));
      return;
    }
    switch (a.dataset.act) {
      case "toggle-tools": {
        const g = a.closest(".tools"); const open = g.dataset.open !== "true";
        g.dataset.open = String(open); a.setAttribute("aria-expanded", String(open));
        if (open) { const l = g.querySelector(".tools-list[hx-get]"); if (l) htmx.trigger(l, "dh-open"); }
        if (g.id) { open ? opened.add(g.id) : opened.delete(g.id); sessionStorage.setItem("dh-open", JSON.stringify([...opened])); }
        break;
      }
      case "theme": {
        const next = root.classList.contains("dark") ? "light" : "dark";
        root.setAttribute("data-theme", next); localStorage.setItem("dh-theme", next); syncDark();
        post("/speca/settings/theme", { theme: next });
        break;
      }
      case "toggle-side": toggleSide(); break;
      case "sb-toggle": toggleSb(); break;
      case "row-menu": { e.preventDefault(); e.stopPropagation(); openRowMenu(a); break; }
      case "md-run": {
        const cmd = a.closest(".md-code")?.querySelector("code")?.innerText ?? "";
        if (cmd.trim()) runInTerminal(cmd);
        break;
      }
      case "md-copy": {
        const box = a.closest(".md-table, .md-code");
        let text = "";
        if (box?.classList.contains("md-table")) text = [...box.querySelectorAll("tr")].map((tr) => [...tr.children].map((c) => c.innerText.replace(/\s+/g, " ").trim()).join("\t")).join("\n");
        else text = box?.querySelector("code")?.innerText ?? "";
        navigator.clipboard?.writeText(text).then(() => toast(document.documentElement.lang === "ru" ? "Скопировано" : "Copied", "", "success"));
        break;
      }
      case "md-expand": {
        const tbl = a.closest(".md-table")?.querySelector("table"); const d = $("#dlg"), body = $("#dlg-body");
        if (!tbl || !d || !body) break;
        body.innerHTML = `<div class="md md-table-full"><div class="mt-scroll">${tbl.outerHTML}</div></div>`;
        d.classList.add("wide"); if (!d.open) d.showModal();
        d.addEventListener("close", () => d.classList.remove("wide"), { once: true });
        break;
      }
      case "brief-more": { const b = a.closest("#brief, .brief")?.querySelector(".brief-body"); if (b) { b.dataset.open = "true"; (a.parentElement?.childElementCount === 1 && !a.parentElement.matches("#brief, .brief") ? a.parentElement : a).remove(); } break; }
      case "view-menu": openViewMenu(a); break;
      case "chat-pop": chatPop(); break;
      case "mpick": toggleModelPicker(a); break;
      case "tabs-menu": openTabsMenu(a); break;
      case "vp-close": a.closest("details.verpop")?.removeAttribute("open"); break;
      case "ver-drawer": verShow(!verOpen); break;
      // a version's name, changed in place (the versions menu, the journal): Enter keeps it, Esc leaves it as it was
      case "ver-rename": {
        const row = a.closest(".vp-vrow, .jr-row"), f = row?.querySelector("form.ver-name"), inp = f?.querySelector("input");
        if (!f || !inp) break;
        row.classList.add("renaming"); f.hidden = false; inp.focus(); inp.select();
        const done = () => { row.classList.remove("renaming"); f.hidden = true; };
        inp.onkeydown = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); inp.value = inp.defaultValue; done(); } };
        inp.onblur = () => setTimeout(() => { if (!f.hidden && document.activeElement !== inp) { inp.value = inp.defaultValue; done(); } }, 150);
        f.addEventListener("htmx:afterRequest", (e) => { if (!e.detail.successful) return; inp.defaultValue = inp.value; done(); if (f.dataset.journal && f.closest("#dlg-body")) htmx.ajax("GET", f.dataset.journal, { target: "#dlg-body", swap: "innerHTML" }); }, { once: true });
        break;
      }
      case "native-pick": {
        const f = a.closest("form"), inp = f?.querySelector("input[name=workdir]");
        a.disabled = true;
        post("/speca/fs/pick").then((r) => r.json()).then((j) => {
          if (j.path && inp) { inp.value = j.path; const n = f.querySelector("input[name=name]"); if (n && !n.value.trim()) n.placeholder = j.path.split("/").pop(); f.querySelector(".fs-box").innerHTML = ""; }
        }).catch(() => {}).finally(() => { a.disabled = false; window.focus(); });
        break;
      }
      case "pick-dir": { const f = a.closest("form"), inp = f?.querySelector("input[name=workdir]"); if (inp) { inp.value = a.dataset.v; const n = f.querySelector("input[name=name]"); if (n && !n.value.trim()) n.placeholder = a.dataset.v.split("/").pop(); } a.closest(".fs-box").innerHTML = ""; break; }
      case "close-dialog": $("#dlg")?.close(); break;
      case "copy-text": navigator.clipboard?.writeText(a.textContent.trim()).then(() => toast(a.dataset.copied || "✓")).catch(() => {}); break;
      case "rename": rename(); break;
      case "sug": { const t = $("#cin"); if (t) { t.value = a.dataset.v; autosize(t); htmx.trigger(t.closest("form"), "submit"); } break; }
      case "ask-about": askCoordinator((document.documentElement.lang === "ru" ? "Чем сейчас занят(а) " : "What is ") + a.dataset.v + (document.documentElement.lang === "ru" ? "? Что у него/неё в работе и что ждёт решения?" : " working on right now?")); break;
      case "coord-ask": askCoordinator(a.dataset.v, false); break;
      case "share-to": askCoordinator((document.documentElement.lang === "ru" ? "Поделись с " : "Share with ") + a.dataset.v + ": ", false); break;
      case "assign-to": askCoordinator((document.documentElement.lang === "ru" ? "Поручи " : "Ask ") + a.dataset.v + (document.documentElement.lang === "ru" ? ": " : " to "), false); break;
      case "copy": navigator.clipboard?.writeText(a.dataset.v || ""); toast(document.documentElement.lang === "ru" ? "Скопировано" : "Copied"); break;
      case "copy-msg": { const md = a.closest(".a")?.querySelector(".md"); navigator.clipboard?.writeText(md?.innerText || ""); toast(document.documentElement.lang === "ru" ? "Скопировано" : "Copied"); break; }
      case "chip-x": {
        const chip = a.closest(".cchip"); const t = $("#cin");
        if (chip?.classList.contains("ctx")) ctxDropped = chip.dataset.tab;
        if (chip?.dataset.name && t) { t.value = t.value.split(`[${chip.dataset.name}]`).join("").replace(/ {2,}/g, " "); autosize(t); }
        chip?.remove(); break;
      }
      case "attach": $("#cfile")?.click(); break;
      case "proj-toggle": case "folder-toggle": case "nav-more": {
        const box = a.closest("[data-open]"); const open = box.dataset.open !== "true";
        box.dataset.open = String(open); a.setAttribute("aria-expanded", String(open));
        if (box.matches(".proj, .folder")) saveFolded();
        break;
      }
      case "sec-toggle": { const s = a.closest(".sec"); const open = s.dataset.open !== "true"; s.dataset.open = String(open); a.setAttribute("aria-expanded", String(open)); break; }
      case "select-all": a.select?.(); break;
      case "sb-open-m": $("#app").dataset.sb = "open-m"; break;
      case "sb-close-m": $("#app").dataset.sb = "closed-m"; break;
      case "mview": $("#app").dataset.mview = a.dataset.v; $$("[data-act=mview]").forEach((b) => b.setAttribute("aria-pressed", String(b === a))); break;
      case "palette": openPalette(); break;
      case "projects-fold": foldProjects(); break;
      case "show-progress": { const app = $("#app"); if (app.dataset.side !== "open") toggleSide(); document.querySelector(".sec[data-sec=progress]")?.scrollIntoView({ behavior: "smooth" }); break; }
    }
  });

  function askCoordinator(text, send = true) {
    const input = $(".day-ask input[name=text]") || $("#cin");
    if (!input) { location.href = "/speca/coordinator?ask=" + encodeURIComponent(text); return; }
    input.value = text; input.focus();
    if (send && input.closest("form")) htmx.trigger(input.closest("form"), "submit");
  }

  // a canvas tab renamed in place: double click on it (or F2 on it); a field over the tab, so a redraw of the strip
  // does not take it away
  function renameTab(tab) {
    if (!tab?.dataset.rename || document.querySelector(".tab-ren")) return;
    const tl = tab.querySelector(".tl"), r = tab.getBoundingClientRect(), id = tab.dataset.tab, was = tl.textContent.trim();
    const f = document.createElement("input");
    f.className = "input tab-ren"; f.value = was; f.maxLength = 120; f.setAttribute("aria-label", tab.dataset.rename); f.spellcheck = false;
    Object.assign(f.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${Math.max(160, r.width)}px`, height: `${r.height}px` });
    document.body.appendChild(f); f.focus(); f.select();
    let done = false;
    const end = async (save) => {
      if (done) return; done = true; f.remove();
      const v = f.value.replace(/\s+/g, " ").trim();
      if (!save || !v || v === was) return;
      const at = () => document.querySelector(`#tabs .tab[data-tab="${CSS.escape(id)}"]`);
      const set = (x) => { const t = at(); if (!t) return; t.dataset.named = ""; t.querySelector(".tl").textContent = x; t.dataset.tooltip = `${x} · ${t.dataset.sub ?? ""}`.replace(/ · $/, ""); };
      set(v);
      const res = await post(`/speca/canvas/${id}/title`, { title: v }).catch(() => null);
      if (!res?.ok) { set(was); window.dhToast?.(await res?.text().catch(() => "") || "!", "", "error"); }
    };
    f.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); end(true); } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); end(false); } });
    f.addEventListener("blur", () => end(true));
  }
  document.addEventListener("dblclick", (e) => { const tab = e.target.closest(".tabstrip .tab[data-tab]"); if (tab && !e.target.closest(".tx")) { e.preventDefault(); renameTab(tab); } });
  document.addEventListener("keydown", (e) => { if (e.key === "F2" && e.target.matches?.(".tabstrip .tab[data-tab]")) { e.preventDefault(); e.stopPropagation(); renameTab(e.target); } }, true);

  function rename() {
    const n = $("#chat-head .n"); const form = $("#composer");
    if (!n || !form) return;
    const v = prompt(document.documentElement.lang === "ru" ? "Название сессии" : "Session title", n.textContent.trim());
    if (v && v.trim()) post(`/speca/s/${form.dataset.session}/rename`, { title: v.trim() }).then(() => { n.textContent = v.trim(); });
  }

  // ── attachments: the + button, paste and drag & drop all end in POST /uploads → a chip in the composer ──
  // attachments: a chip above the text and a [name] mention where the cursor was — the text can say "this one"
  function uniqueName(name) {
    const taken = new Set($$("#cchips .cchip.att").map((c) => c.dataset.name));
    if (!taken.has(name)) return name;
    const dot = name.lastIndexOf("."), base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
    for (let i = 2; ; i++) if (!taken.has(`${base} ${i}${ext}`)) return `${base} ${i}${ext}`;
  }
  function insertMention(t, token) {
    const s = t.selectionStart ?? t.value.length, e = t.selectionEnd ?? s;
    const before = t.value.slice(0, s), after = t.value.slice(e);
    const pad = before && !/\s$/.test(before) ? " " : "";
    t.value = before + pad + token + (after.startsWith(" ") ? "" : " ") + after;
    const at = (before + pad + token).length + 1;
    t.setSelectionRange(at, at); autosize(t);
  }
  async function upload(files) {
    const form = $("#composer"); if (!form) return;
    const t = $("#cin");
    for (const f of files) {
      const name = uniqueName(f.name || "image.png");
      const fd = new FormData(); fd.append("file", f, name); fd.append("session", form.dataset.session);
      const r = await fetch("/speca/uploads", { method: "POST", headers: { "x-csrf": csrf(), "hx-request": "true" }, body: fd });
      if (!r.ok) { toast(document.documentElement.lang === "ru" ? "Не удалось загрузить" : "Could not upload", f.name, "error"); continue; }
      $("#cchips").insertAdjacentHTML("beforeend", await r.text());
      if (t) insertMention(t, `[${name}]`);
    }
    t?.focus();
  }
  window.dhAttach = upload;   // plugins (e.g. the browser's "screenshot to chat") attach files to the composer
  document.addEventListener("change", (e) => { if (e.target.id === "cfile") { upload([...e.target.files]); e.target.value = ""; } });
  document.addEventListener("paste", (e) => {
    if (!e.target.closest?.("#composer")) return;
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.length) { e.preventDefault(); upload(files); }
  });
  document.addEventListener("dragover", (e) => { if (e.target.closest?.("#chat") && $("#composer")) { e.preventDefault(); $("#composer").classList.add("drop"); } });
  document.addEventListener("dragleave", (e) => { if (!e.relatedTarget || !e.relatedTarget.closest?.("#chat")) $("#composer")?.classList.remove("drop"); });
  document.addEventListener("drop", (e) => {
    if (!e.target.closest?.("#chat") || !$("#composer")) return;
    e.preventDefault(); $("#composer").classList.remove("drop");
    upload([...(e.dataTransfer?.files ?? [])]);
  });

  // ── layout ──
  function toggleSide() { const app = $("#app"); if (!app) return; app.dataset.side = app.dataset.side === "open" ? "closed" : "open"; post("/speca/settings/layout", { side: app.dataset.side }); }
  // the "⋯" of a chat in the sidebar: one shared menu, placed next to the row
  let rowSid = null;
  function openRowMenu(btn) {
    const m = $("#rowmenu"), row = btn.closest(".sess"); if (!m || !row) return;
    rowSid = row.dataset.sid;
    const pin = m.querySelector(".rm-pin"); if (pin) pin.textContent = row.dataset.pinned === "true" ? pin.dataset.on : pin.dataset.off;
    m.querySelectorAll("[data-rm=move]").forEach((b) => { b.hidden = b.dataset.project === (row.dataset.project || ""); });
    m.hidden = false;
    const r = btn.getBoundingClientRect(), mh = m.offsetHeight;
    m.style.left = Math.min(r.right + 6, innerWidth - m.offsetWidth - 8) + "px";
    m.style.top = Math.max(8, Math.min(r.top - 4, innerHeight - mh - 8)) + "px";
  }
  document.addEventListener("click", async (e) => {
    const m = $("#rowmenu"); if (!m || m.hidden) return;
    const item = e.target.closest("#rowmenu [data-rm]");
    if (!item) { if (!e.target.closest("[data-act=row-menu]")) m.hidden = true; return; }
    m.hidden = true;
    const sid = rowSid, row = document.querySelector(`.sess[data-sid="${sid}"]`), ru = document.documentElement.lang === "ru";
    const refresh = () => { const sb = $("#sb-inner"); if (sb) htmx.trigger(sb, "dh-live"); };
    switch (item.dataset.rm) {
      case "rename": { const cur = row?.querySelector(".tt")?.textContent.trim() ?? ""; const v = prompt(ru ? "Название чата" : "Chat title", cur); if (v && v.trim()) { await post(`/speca/s/${sid}/rename`, { title: v.trim() }); refresh(); } break; }
      case "pin": await post(`/speca/s/${sid}/pin`); refresh(); break;
      case "move": await post(`/speca/s/${sid}/move`, { project: item.dataset.project || "" }); refresh(); break;
      case "delete":
        if (!confirm(ru ? "Удалить чат? Он уйдёт в архив; его холсты и файлы останутся в «Артефактах», а сам чат можно вернуть через поиск." : "Delete the chat? It goes to the archive; its canvases and files stay in Artifacts, and the chat can be found and restored through search.")) break;
        await post(`/speca/s/${sid}/archive?stay=1`);
        if (location.pathname === `/speca/s/${sid}`) location.href = "/speca/day"; else refresh();
        break;
    }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { const m = $("#rowmenu"); if (m) m.hidden = true; } });
  // a click inside a canvas page (an iframe) or in another window never reaches this document: when the focus
  // leaves it, every open menu and popover closes, as a click outside would do
  function closeAllMenus() {
    $$("[data-popover][aria-hidden=false]").forEach((p) => { p.setAttribute("aria-hidden", "true"); p.closest(".dropdown-menu, .popover")?.querySelector("[aria-expanded=true]")?.setAttribute("aria-expanded", "false"); });
    $$("details.verpop[open]").forEach((d) => d.removeAttribute("open"));
    const rm = $("#rowmenu"); if (rm) rm.hidden = true;
    closeViewMenu(); closeTabsMenu(); closeModelPicker();
    const sp = $(".slash-pop"); if (sp) sp.hidden = true;
  }
  window.addEventListener("blur", () => setTimeout(() => { if (document.activeElement?.tagName === "IFRAME" || !document.hasFocus()) closeAllMenus(); }, 0));
  function toggleSb() {
    const app = $("#app"); if (!app) return;
    if (matchMedia("(max-width: 820px)").matches) { app.dataset.sb = app.dataset.sb === "open-m" ? "closed" : "open-m"; return; }
    const next = app.dataset.sb === "rail" ? "open" : "rail";
    // one quick move of the column, the panel's content swapped at once (a page-wide view transition on top of the
    // column's own made the canvas and the panel jump)
    app.dataset.sb = next;
    post("/speca/settings/layout", { sb: next });   // remembered on the server: the next page is drawn that way at once
  }
  const VIEWS = ["full", "work", "chat", "solo", "canvas"];
  const VIEW_KEYS = [...VIEWS, "focus"];
  // shortcut labels: ⌘ on a Mac, Ctrl elsewhere
  const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  // slash commands (as in Claude Code): suggestions while the first word is typed, the command highlighted in the text
  const escHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  function slashList(form) { try { return JSON.parse(form.dataset.slash || "[]"); } catch { return []; } }
  function paintCin(t) {
    const hl = t.parentElement?.querySelector(".cin-hl"); if (!hl) return;
    const form = t.closest("form"), m = /^\/([a-z]+)/i.exec(t.value);
    const known = m && slashList(form).some((x) => x.c === m[1].toLowerCase());
    hl.innerHTML = known ? `<mark>${escHtml(m[0])}</mark>${escHtml(t.value.slice(m[0].length))}\n` : escHtml(t.value) + "\n";
    hl.scrollTop = t.scrollTop;
  }
  function slashPop(t) {
    const pop = t.parentElement?.querySelector(".slash-pop"); if (!pop) return;
    const m = /^\/([a-z]*)$/i.exec(t.value);
    const items = m ? slashList(t.closest("form")).filter((x) => x.c.startsWith(m[1].toLowerCase())) : [];
    if (!items.length) { pop.hidden = true; pop.innerHTML = ""; return; }
    pop.innerHTML = items.map((x, i) => `<button type="button" class="sp-i${i ? "" : " hl"}" role="option" data-cmd="${x.c}"><b>/${x.c}</b>${x.a ? `<span class="sp-a">${escHtml(x.a)}</span>` : ""}<span class="sp-d">${escHtml(x.d)}</span></button>`).join("");
    pop.hidden = false;
  }
  function slashPick(t, cmd) {
    t.value = `/${cmd} `; autosize(t); paintCin(t); slashPop(t); t.focus();
    t.setSelectionRange(t.value.length, t.value.length);
  }
  document.addEventListener("input", (e) => { if (e.target.id === "cin") { paintCin(e.target); slashPop(e.target); } });
  document.addEventListener("scroll", (e) => { if (e.target.id === "cin") paintCin(e.target); }, true);
  document.addEventListener("htmx:afterRequest", (e) => { if (e.detail.elt.id === "composer") { const t = $("#cin"); if (t) { paintCin(t); slashPop(t); } } });
  document.addEventListener("click", (e) => { const b = e.target.closest(".slash-pop .sp-i"); if (b) slashPick($("#cin"), b.dataset.cmd); });
  document.addEventListener("keydown", (e) => {
    if (e.target.id !== "cin") return;
    const pop = e.target.parentElement.querySelector(".slash-pop"); if (!pop || pop.hidden) return;
    const its = [...pop.querySelectorAll(".sp-i")], cur = its.findIndex((b) => b.classList.contains("hl"));
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault(); e.stopImmediatePropagation();
      const n = (cur + (e.key === "ArrowDown" ? 1 : -1) + its.length) % its.length; its.forEach((b, i) => b.classList.toggle("hl", i === n)); return;
    }
    if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) { e.preventDefault(); e.stopImmediatePropagation(); slashPick(e.target, (its[cur] || its[0]).dataset.cmd); return; }
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); pop.hidden = true; }
  }, true);
  // the canvas chip of the composer follows the active tab (a tab the person dropped stays dropped until another opens)
  let ctxDropped = null;
  function syncCanvasChip(activeId) {
    const box = $("#cchips"), tpl = $("#ctxchip-tpl"); if (!box || !tpl) return;
    const tab = activeId ? $(`.tab[data-tab="${activeId}"]`) : $(".tab[aria-selected=true]");
    let chip = box.querySelector(".cchip.ctx");
    if (!tab) { chip?.remove(); return; }
    const id = tab.dataset.tab, title = tab.getAttribute("title") || tab.textContent.trim();
    if (ctxDropped && ctxDropped !== id) ctxDropped = null;
    if (ctxDropped === id) { chip?.remove(); return; }
    if (!chip) { chip = tpl.content.firstElementChild.cloneNode(true); box.prepend(chip); }
    chip.dataset.tab = id; chip.querySelector("input[name=ctx_tab]").value = id; chip.querySelector(".mono").textContent = title;
  }
  document.addEventListener("click", (e) => { const tab = e.target.closest(".tab[data-tab]"); if (tab && !e.target.closest("[data-act]")) syncCanvasChip(tab.dataset.tab); });
  document.addEventListener("htmx:afterSettle", () => syncCanvasChip());
  // the model picker: search, a source rail, arrows + Enter, ⌘1…⌘9 for the visible ones; a pick saves at once
  let mpSrc = "";
  function mpOpen() { const p = $(".mpick:not([hidden])"); return p; }
  function closeModelPicker() { const p = mpOpen(); if (!p) return; p.hidden = true; p.parentElement.querySelector("[data-act=mpick]")?.setAttribute("aria-expanded", "false"); }
  function toggleModelPicker(btn) {
    const p = btn.parentElement.querySelector(".mpick"); if (!p) return;
    if (!p.hidden) { closeModelPicker(); return; }
    p.hidden = false; btn.setAttribute("aria-expanded", "true");
    const r = btn.getBoundingClientRect();
    p.style.left = Math.max(8, Math.min(r.left, innerWidth - p.offsetWidth - 8)) + "px";
    p.style.bottom = (innerHeight - r.top + 8) + "px";
    const inp = p.querySelector(".mp-search input"); inp.value = ""; mpSrc = "";
    p.querySelectorAll(".mp-src").forEach((b) => b.setAttribute("aria-current", "false"));
    mpFilter(p); inp.focus();
    p.querySelector('.mp-i[aria-selected="true"]')?.classList.add("hl");
  }
  function mpVisible(p) { return [...p.querySelectorAll(".mp-i")].filter((b) => !b.hidden); }
  function mpFilter(p) {
    const q = p.querySelector(".mp-search input").value.trim().toLowerCase();
    p.querySelectorAll(".mp-i").forEach((b) => { b.hidden = (!!mpSrc && !b.dataset.dialog && b.dataset.src !== mpSrc) || (!!q && !q.split(/\s+/).every((w) => b.dataset.q.includes(w))); b.classList.remove("hl"); });
    const vis = mpVisible(p);
    vis.filter((b) => !b.dataset.dialog).forEach((b, i) => { b.querySelector(".mp-k").textContent = i < 9 ? `⌘${i + 1}` : ""; });
    p.querySelector(".mp-none").hidden = vis.some((b) => !b.dataset.dialog);
    const h = p.querySelector(".mp-h"); if (h) h.hidden = !vis.some((b) => b.dataset.dialog);
    (vis.find((b) => b.getAttribute("aria-selected") === "true") || vis[0])?.classList.add("hl");
  }
  async function mpPick(p, b) {
    if (!b) return;
    if (b.dataset.dialog) { closeModelPicker(); b.click(); return; }
    const sid = p.dataset.session, btn = p.parentElement.querySelector("[data-act=mpick]");
    closeModelPicker();
    const r = await post(`/speca/s/${sid}/model`, { v: b.dataset.ref });
    if (!r.ok) { toast((await r.text()).slice(0, 200) || "Error", "", "error"); return; }
    p.querySelectorAll(".mp-i").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    btn.querySelector("span").textContent = b.querySelector(".mp-n").textContent;
    const si = b.querySelector(".mp-s svg"), bi = btn.querySelector("svg");
    if (si && bi) { const c = si.cloneNode(true); c.setAttribute("class", bi.getAttribute("class")); bi.replaceWith(c); }
    // effort is a Claude setting: its menu shows only for Claude models
    const eff = $(".eff-wrap"); if (eff) eff.hidden = b.dataset.effort !== "1";
  }
  document.addEventListener("input", (e) => { const p = e.target.closest?.(".mpick"); if (p) mpFilter(p); });
  document.addEventListener("click", (e) => {
    const p = mpOpen(); if (!p) return;
    const src = e.target.closest(".mp-src");
    if (src && src.dataset.dialog && p.contains(src)) { closeModelPicker(); return; }
    if (src && p.contains(src)) { mpSrc = mpSrc === src.dataset.src ? "" : src.dataset.src; p.querySelectorAll(".mp-src").forEach((b) => b.setAttribute("aria-current", String(!!mpSrc && b.dataset.src === mpSrc))); mpFilter(p); p.querySelector(".mp-search input").focus(); return; }
    if (src && p.contains(src)) { mpSrc = src.dataset.src; p.querySelectorAll(".mp-src").forEach((b) => b.setAttribute("aria-current", String(b === src))); mpFilter(p); p.querySelector(".mp-search input").focus(); return; }
    const it = e.target.closest(".mp-i");
    if (it && p.contains(it)) { if (it.dataset.dialog) closeModelPicker(); else mpPick(p, it); return; }
    if (!e.target.closest(".mp-wrap")) closeModelPicker();
  });
  document.addEventListener("keydown", (e) => {
    const p = mpOpen(); if (!p) return;
    const vis = mpVisible(p), cur = vis.findIndex((b) => b.classList.contains("hl"));
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeModelPicker(); p.parentElement.querySelector("[data-act=mpick]")?.focus(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault(); if (!vis.length) return;
      const n = (cur + (e.key === "ArrowDown" ? 1 : -1) + vis.length) % vis.length;
      vis.forEach((b, i) => b.classList.toggle("hl", i === n)); vis[n].scrollIntoView({ block: "nearest" }); return;
    }
    if (e.key === "Enter") { e.preventDefault(); mpPick(p, vis[cur] || vis[0]); return; }
    if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) { e.preventDefault(); mpPick(p, vis.filter((b) => !b.dataset.dialog)[+e.key - 1]); }
  }, true);
  // all canvas tabs in a list with search (like Chrome's tab search): go to one, close one
  let tabsMenuEl = null;
  function closeTabsMenu() { tabsMenuEl?.remove(); tabsMenuEl = null; }
  function openTabsMenu(btn) {
    if (tabsMenuEl) { closeTabsMenu(); return; }
    // the design system's menu (docs/DESIGN.md §3 Menu): search, then one scrolling list of two-line items
    const m = document.createElement("div"); m.className = "menu menu-pop tabsmenu"; m.setAttribute("role", "menu");
    m.innerHTML = `<label class="menu-q">${btn.dataset.qicon || ""}<input type="text" placeholder="${escHtml(btn.dataset.ph || "")}" autocomplete="off" spellcheck="false"></label><div class="menu-list divided"></div><div class="menu-none" hidden>${escHtml(btn.dataset.none || "")}</div>`;
    const list = m.querySelector(".menu-list");
    for (const tab of $$(".tabstrip .tab[data-tab]")) {
      const row = document.createElement("div"); row.className = "menu-i"; row.dataset.tab = tab.dataset.tab; row.setAttribute("role", "menuitem"); row.tabIndex = -1;
      if (tab.getAttribute("aria-selected") === "true") row.setAttribute("aria-current", "true");
      const ico = tab.querySelector("svg.tico")?.cloneNode(true) ?? tab.querySelector("svg")?.cloneNode(true); if (ico) { ico.setAttribute("class", "ic"); row.append(ico); }
      const name = tab.querySelector(".tl")?.textContent?.trim() || tab.getAttribute("title") || "";
      row.insertAdjacentHTML("beforeend", `<span class="menu-t"><b>${escHtml(name)}</b><small>${escHtml(tab.dataset.sub || "")}</small></span>${tab.querySelector(".tx") ? `<button type="button" class="menu-x" aria-label="${escHtml(btn.dataset.close || "")}">${btn.dataset.xicon || "×"}</button>` : ""}`);
      list.append(row);
    }
    // the project's pinned tabs not open in this chat: opened here by a click
    const pins = $("#pins-tpl");
    if (pins) {
      const h = document.createElement("div"); h.className = "menu-h"; h.textContent = pins.dataset.heading || ""; list.append(h);
      list.append(pins.content.cloneNode(true));
    }
    document.body.append(m); tabsMenuEl = m;
    const r = btn.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 8)) + "px";
    m.style.top = r.bottom + 6 + "px";
    m.style.setProperty("--ox", `${r.right - parseFloat(m.style.left)}px`); m.style.setProperty("--oy", "0px");
    list.querySelector("[aria-current=true]")?.scrollIntoView({ block: "nearest" });
    const q = m.querySelector("input"); q.focus();
    q.addEventListener("input", () => {
      const v = q.value.trim().toLowerCase(); let any = false;
      list.querySelectorAll(".menu-i").forEach((x) => { x.hidden = !!v && !x.textContent.toLowerCase().includes(v); any ||= !x.hidden; });
      const h = list.querySelector(".menu-h"); if (h) h.hidden = ![...list.querySelectorAll(".menu-i[data-pin]")].some((x) => !x.hidden);
      m.querySelector(".menu-none").hidden = any;
    });
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") { list.querySelector(".menu-i:not([hidden])")?.click(); } });
    m.addEventListener("click", (e) => {
      const row = e.target.closest(".menu-i"); if (!row) return;
      if (row.dataset.pin) { closeTabsMenu(); htmx.ajax("POST", `/speca/s/${pins.dataset.session}/canvas/pinned`, { swap: "none", values: { tab: row.dataset.pin } }); return; }
      const tab = $(`.tabstrip .tab[data-tab="${row.dataset.tab}"]`);
      if (e.target.closest(".menu-x")) { e.stopPropagation(); htmx.ajax("POST", `/speca/canvas/${row.dataset.tab}/close`, { swap: "none" }); tab?.classList.add("out"); row.remove(); return; }
      closeTabsMenu(); tab?.click(); tab?.scrollIntoView({ inline: "nearest", block: "nearest" });
    });
  }
  // a tab's menu (right click on a tab, or on a tab in the list): rename, close, close the others, close all
  let tabCtxEl = null;
  function closeTabCtx() { tabCtxEl?.remove(); tabCtxEl = null; }
  function openTabCtx(e, id) {
    const strip = $("#tabs"), L = strip?.dataset.cm ? JSON.parse(strip.dataset.cm) : null;
    if (!L) return;
    e.preventDefault(); closeTabCtx();
    const m = document.createElement("div"); m.className = "menu menu-pop tabctx"; m.setAttribute("role", "menu");
    const n = $$(".tabstrip .tab[data-tab]").length;
    const pinned = $(`.tabstrip .tab[data-tab="${CSS.escape(id)}"]`)?.hasAttribute("data-pinned");
    m.innerHTML = [["rename", L.rename], ...(L.pin ? [pinned ? ["unpin", L.unpin] : ["pin", L.pin]] : []), ["close", L.close], ["others", L.others, n < 2], ["all", L.all]]
      .map(([a, label, off]) => `${a === "close" ? "<hr>" : ""}<button type="button" class="menu-i" role="menuitem" data-tc="${a}"${off ? " disabled" : ""}>${escHtml(label)}</button>`).join("");
    document.body.append(m); tabCtxEl = m;
    m.style.left = Math.min(e.clientX, innerWidth - m.offsetWidth - 8) + "px";
    m.style.top = Math.min(e.clientY, innerHeight - m.offsetHeight - 8) + "px";
    m.addEventListener("click", async (ev) => {
      const b = ev.target.closest("[data-tc]"); if (!b || b.disabled) return;
      ev.stopPropagation(); closeTabCtx(); closeTabsMenu();
      const tab = $(`.tabstrip .tab[data-tab="${CSS.escape(id)}"]`);
      if (b.dataset.tc === "rename") { renameTab(tab); return; }
      if (b.dataset.tc === "pin" || b.dataset.tc === "unpin") { htmx.ajax("POST", `/speca/canvas/${id}/pin`, { swap: "none", values: { on: b.dataset.tc === "pin" ? "1" : "0" } }); return; }
      if (b.dataset.tc === "close") { tab?.classList.add("out"); htmx.ajax("POST", `/speca/canvas/${id}/close`, { swap: "none" }); return; }
      const keep = b.dataset.tc === "others" ? id : "";
      $$(".tabstrip .tab[data-tab]").forEach((t) => { if (t.dataset.tab !== keep) t.classList.add("out"); });
      const r = await post(`/speca/s/${strip.dataset.session}/canvas/close`, keep ? { except: keep } : {}).catch(() => null);
      if (!r?.ok) toast((await r?.text().catch(() => "")) || "Error", "", "error");
    });
  }
  document.addEventListener("contextmenu", (e) => {
    const t = e.target.closest(".tabstrip .tab[data-tab], .tabsmenu .menu-i[data-tab]"); if (t) openTabCtx(e, t.dataset.tab);
  });
  document.addEventListener("click", (e) => { if (tabCtxEl && !e.target.closest(".tabctx")) closeTabCtx(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeTabCtx(); });
  // a version deleted from the journal (the dialog): the journal is shown again without it
  document.addEventListener("htmx:afterRequest", (e) => {
    const b = e.detail.elt; if (!e.detail.successful || !b?.matches?.("button[data-journal]") || !b.closest("#dlg-body")) return;
    htmx.ajax("GET", b.dataset.journal, { target: "#dlg-body", swap: "innerHTML" });
  });
  // a canvas's history: a drawer at the canvas's right edge, over the content but without a scrim; it stays open while the
  // person looks at versions (each look redraws the body with it) and is laid exactly over the canvas's body
  let verOpen = false;
  function verPlace(d) {
    const body = $("#cbody"), p = d.offsetParent;
    if (!body || !p) return;
    // under the document's title line (its chip stays in view), else from the top of the body
    // under the title line or the floating chip of a full-bleed canvas (both hold the chip that opened it)
    const b = body.getBoundingClientRect(), pr = p.getBoundingClientRect(), head = body.querySelector(".doc > .doc-h, .bare-ver")?.getBoundingClientRect();
    const top = head && head.bottom > b.top && head.bottom < b.bottom ? head.bottom + (body.querySelector(".bare-ver") ? 8 : 0) : b.top;
    d.style.top = `${top - pr.top}px`; d.style.height = `${b.bottom - top}px`;
  }
  function verShow(on, now = false) {
    verOpen = on;
    $$('[data-act="ver-drawer"][aria-controls]').forEach((x) => x.setAttribute("aria-expanded", String(on)));
    const d = $("#verdrawer");
    if (!d) return;
    if (on) { d.hidden = false; verPlace(d); if (now) d.classList.add("in", "now"); else requestAnimationFrame(() => d.classList.add("in")); }
    else { d.classList.remove("in", "now"); setTimeout(() => { if (!verOpen) d.hidden = true; }, 180); }
  }
  document.addEventListener("htmx:afterSettle", () => { if (verOpen) verShow(true, true); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && verOpen && !e.target.closest?.("input, textarea, dialog[open]")) verShow(false); });
  addEventListener("resize", () => { const d = $("#verdrawer"); if (verOpen && d) verPlace(d); });
  // the versions panel closes on a click outside it
  document.addEventListener("click", (e) => { $$("details.verpop[open]").forEach((d) => { if (!d.contains(e.target)) d.removeAttribute("open"); }); });
  document.addEventListener("click", (e) => { if (tabsMenuEl && !e.target.closest(".tabsmenu, [data-act=tabs-menu]")) closeTabsMenu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeTabsMenu(); });
  // "Screen view": a menu of the five layouts (current one checked), like before
  let viewMenuEl = null;
  function closeViewMenu() { viewMenuEl?.remove(); viewMenuEl = null; }
  function openViewMenu(btn) {
    if (viewMenuEl) { closeViewMenu(); return; }
    const tpl = $("#viewmenu-tpl"); if (!tpl) { cycleView(); return; }
    const m = document.createElement("div"); m.className = "cm vmenu"; m.setAttribute("role", "menu");
    m.append(tpl.content.cloneNode(true));
    const cur = $("#app")?.dataset.view || "full";
    m.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.view === cur)));
    if (!MAC) m.querySelectorAll("[data-sc]").forEach((x) => { x.textContent = `Ctrl ${x.dataset.sc}`; });
    document.body.append(m); viewMenuEl = m;
    const r = btn.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 8)) + "px";
    m.style.top = Math.min(r.bottom + 6, innerHeight - m.offsetHeight - 8) + "px";
    m.addEventListener("click", (e) => { const b = e.target.closest("[data-view]"); if (!b) return; closeViewMenu(); setView(b.dataset.view); });
    m.querySelector(`[data-view="${cur}"]`)?.focus();
  }
  document.addEventListener("click", (e) => { if (viewMenuEl && !e.target.closest(".vmenu, [data-act=view-menu]")) closeViewMenu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeViewMenu(); });
  // the quick chat: in the canvas-only and full-screen views the agent window comes up as a panel from the bottom
  // (the same chat, not a copy) and goes away again; while hidden, its button shows that the agent works or answered
  const POP_VIEWS = ["canvas", "focus"];
  const popView = () => POP_VIEWS.includes($("#app")?.dataset.view);
  function chatPop(open, focusInput = true) {
    const app = $("#app"), chat = $("#chat"); if (!app || !chat) return;
    const on = open ?? app.dataset.pop !== "open";
    if (on && !popView()) return;
    if (on) {
      app.dataset.pop = "open"; delete app.dataset.popNew;
      popFrame(chat);
      const log = chat.querySelector(".log"); if (log) log.scrollTop = log.scrollHeight;
      if (focusInput) $("#cin")?.focus();
    } else {
      delete app.dataset.pop;
      if (chat.contains(document.activeElement)) document.activeElement.blur();
    }
    $$("[data-act=chat-pop]").forEach((b) => b.setAttribute("aria-pressed", String(on)));
  }
  // something from the canvas goes into the person's message ("Ask the agent" on an element, a file's lines): they see
  // it go in — in the canvas-only and full-screen views the chat comes up first as the quick panel (⌘J), where it was
  // hidden and the click seemed to do nothing. `at`: "start" (before what is typed), "caret" or "end".
  // something went to the agent from the canvas (a comment sent): in the canvas-only and full-screen views the chat
  // comes up, so the person sees it arrive and the answer start
  window.dhShowChat = () => { if (popView()) chatPop(true, false); };
  window.dhCompose = (text, o = {}) => {
    const cin = $("#cin"); if (!cin) return false;
    if (popView()) chatPop(true, false);
    const where = o.at || "end", v = cin.value;
    const at = where === "start" ? 0 : where === "caret" ? (cin.selectionStart ?? v.length) : v.length;
    const pre = v.slice(0, at), post = v.slice(at);
    const ins = `${pre && !/\s$/.test(pre) ? " " : ""}${text}${post && !/^\s/.test(post) ? " " : ""}`;
    cin.value = pre + ins + post;
    autosize(cin); cin.dispatchEvent(new Event("input", { bubbles: true }));
    cin.focus(); cin.selectionStart = cin.selectionEnd = where === "start" ? cin.value.length : (pre + ins).length;
    // a short mark on the field: this is where it went
    const box = cin.closest(".composer"); box?.classList.add("got-ctx"); setTimeout(() => box?.classList.remove("got-ctx"), 900);
    return true;
  };
  // the panel moves by its header and resizes by its edges; where the person left it is remembered on this device
  const POP_KEY = "dh-chatpop", POP_MIN = { w: 360, h: 240 };
  const popRect = () => { try { return JSON.parse(localStorage.getItem(POP_KEY) || "null"); } catch { return null; } };
  function popPlace(r) {
    const app = $("#app"), st = $("#stage"); if (!app || !st) return;
    if (!r) { delete app.dataset.popPos; ["--px", "--py", "--pw", "--ph"].forEach((v) => app.style.removeProperty(v)); return; }
    const W = st.clientWidth, H = st.clientHeight;
    const w = Math.max(POP_MIN.w, Math.min(r.w, W - 16)), h = Math.max(POP_MIN.h, Math.min(r.h, H - 16));
    const x = Math.max(8, Math.min(r.x, W - w - 8)), y = Math.max(8, Math.min(r.y, H - h - 8));
    app.dataset.popPos = "1";
    app.style.setProperty("--px", `${x}px`); app.style.setProperty("--py", `${y}px`); app.style.setProperty("--pw", `${w}px`); app.style.setProperty("--ph", `${h}px`);
    return { x, y, w, h };
  }
  function popFrame(chat) {
    popPlace(popRect());
    if (chat.querySelector(":scope > .cp-h")) return;
    for (const d of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) { const h = document.createElement("div"); h.className = "cp-h"; h.dataset.d = d; h.setAttribute("aria-hidden", "true"); chat.append(h); }
  }
  document.addEventListener("pointerdown", (e) => {
    const app = $("#app"), chat = $("#chat"), st = $("#stage");
    if (!app || app.dataset.pop !== "open" || !chat || !st || e.button !== 0) return;
    const edge = e.target.closest?.(".cp-h");
    const head = !edge && e.target.closest?.("#chat .chat-head");
    if (!edge && (!head || e.target.closest("button, a, input, select, textarea, [contenteditable], [role=menuitem]"))) return;
    e.preventDefault();
    const sr = st.getBoundingClientRect(), cr = chat.getBoundingClientRect();
    const start = { x: cr.left - sr.left, y: cr.top - sr.top, w: cr.width, h: cr.height }, d = edge?.dataset.d ?? "";
    const px = e.clientX, py = e.clientY;
    let last = start;
    app.classList.add("cp-drag");
    const move = (ev) => {
      const dx = ev.clientX - px, dy = ev.clientY - py, r = { ...start };
      if (!edge) { r.x += dx; r.y += dy; }
      else {
        if (d.includes("e")) r.w = start.w + dx;
        if (d.includes("s")) r.h = start.h + dy;
        if (d.includes("w")) { r.w = Math.max(POP_MIN.w, start.w - dx); r.x = start.x + start.w - r.w; }
        if (d.includes("n")) { r.h = Math.max(POP_MIN.h, start.h - dy); r.y = start.y + start.h - r.h; }
      }
      last = popPlace(r) ?? last;
    };
    const up = () => {
      app.classList.remove("cp-drag");
      removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up);
      if (last !== start) localStorage.setItem(POP_KEY, JSON.stringify(last));
    };
    addEventListener("pointermove", move); addEventListener("pointerup", up); addEventListener("pointercancel", up);
  });
  // a double click on the header puts the panel back to its place at the bottom
  document.addEventListener("dblclick", (e) => {
    if ($("#app")?.dataset.pop !== "open" || !e.target.closest?.("#chat .chat-head") || e.target.closest("button, a, input")) return;
    localStorage.removeItem(POP_KEY); popPlace(null);
  });
  addEventListener("resize", () => { if ($("#app")?.dataset.pop === "open") popPlace(popRect()); });
  function popKey() { if (popView()) chatPop(); else $("#cin")?.focus(); }
  {
    let busy = $("#composer")?.dataset.busy === "true";
    const chat = $("#chat");
    if (chat) new MutationObserver((ms) => {
      const app = $("#app"); if (!app) return;
      const now = $("#composer")?.dataset.busy === "true";
      const hidden = popView() && app.dataset.pop !== "open";
      if (busy && !now && hidden) app.dataset.popNew = "1";
      busy = now;
      // a card that waits for the person must not wait unseen
      if (hidden && ms.some((m) => [...m.addedNodes].some((n) => n.nodeType === 1 && (n.matches("[data-approval]") || n.querySelector("[data-approval]"))))) chatPop(true, false);
    }).observe(chat, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-busy"] });
  }
  // keys pressed inside a canvas page (a sandboxed frame) never reach this document: the frame's shim passes the app's own on
  window.addEventListener("message", (e) => {
    const k = e.data?.dhKey; if (typeof k !== "string") return;
    try { if (!e.source || e.source === window || e.source.top !== window) return; } catch { return; }
    if (k === "j") popKey();
    else if (/^[1-6]$/.test(k)) setView(VIEW_KEYS[+k - 1]);
    else if (k === "Escape" && $("#app")?.dataset.pop === "open") chatPop(false);
  });
  function setView(v) {
    const app = $("#app"); if (!app) return;
    if (!POP_VIEWS.includes(v)) chatPop(false);
    if (v === "focus") return app.dataset.view === "focus" ? leaveFocus() : enterFocus();
    if (app.dataset.view === "focus") { delete app.dataset.before; if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); }
    const go = () => { app.dataset.view = v; }; document.startViewTransition ? document.startViewTransition(go) : go(); post("/speca/settings/layout", { view: v });
  }
  // "Canvas full screen": nothing but the canvas, in the browser's full screen; not remembered — Esc returns
  function enterFocus() {
    const app = $("#app"); if (!app || app.dataset.view === "focus") return;
    app.dataset.before = app.dataset.view || "full";
    const go = () => { app.dataset.view = "focus"; }; document.startViewTransition ? document.startViewTransition(go) : go();
    document.documentElement.requestFullscreen?.().catch(() => {});
    if (app.dataset.focusHint) toast(app.dataset.focusHint, "", "info");
  }
  function leaveFocus() {
    const app = $("#app"); if (!app || app.dataset.view !== "focus") return;
    // the quick chat goes with the full screen; if it was open, the chat stays in sight, docked at its side
    const wasOpen = app.dataset.pop === "open";
    let back = app.dataset.before || "full"; delete app.dataset.before;
    chatPop(false);
    if (wasOpen && back === "canvas") { back = "full"; post("/speca/settings/layout", { view: back }); }
    const go = () => { app.dataset.view = back; }; document.startViewTransition ? document.startViewTransition(go) : go();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  // the browser's own Esc ends its full screen before any key reaches the page: leave the view with it
  document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement) leaveFocus(); });
  function cycleView() { const app = $("#app"); if (!app) return; setView(VIEWS[(VIEWS.indexOf(app.dataset.view || "full") + 1) % VIEWS.length]); }
  // sidebar search: titles filter at once; from two characters the server searches titles, messages and canvases
  let sbTimer = 0, sbSeq = 0;
  function searchSidebar(v) {
    filterSidebar(v);
    clearTimeout(sbTimer);
    const box = $("#sbResults"), list = $("#sbList"), q = v.trim();
    if (!box) return;
    if (q.length < 2) { sbSeq++; box.hidden = true; box.innerHTML = ""; list.hidden = false; return; }
    sbTimer = setTimeout(async () => {
      const n = ++sbSeq;
      const r = await fetch("/speca/f/search?q=" + encodeURIComponent(q), { headers: { "hx-request": "true" } }).catch(() => null);
      if (n !== sbSeq || !r?.ok) return;
      box.innerHTML = await r.text(); htmx.process(box); box.hidden = false; list.hidden = true;
    }, 200);
  }
  document.addEventListener("keydown", (e) => {
    if (e.target.id !== "sbq") return;
    if (e.key === "Escape") { e.target.value = ""; searchSidebar(""); e.target.blur(); }
    if (e.key === "Enter") { e.preventDefault(); $("#sbResults:not([hidden]) .sr-item")?.click(); }
  });
  // the live sidebar refresh would wipe the query and results; skip it while searching
  document.addEventListener("htmx:beforeRequest", (e) => { if (e.detail.elt.id === "sb-inner" && $("#sbq")?.value.trim()) e.preventDefault(); });
  // /s/<id>?at=<idx> — a search result: show that message
  async function jumpToMessage() {
    const at = new URLSearchParams(location.search).get("at");
    if (!at) return false;
    let el = document.querySelector(`#log [data-idx="${CSS.escape(at)}"]`);
    // further back than the turns shown: the pages before it, one by one
    for (let m = $("#log .log-more"); !el && m && Number(m.dataset.before) > Number(at); m = $("#log .log-more")) {
      if (!(await loadOlder(m))) break;
      el = document.querySelector(`#log [data-idx="${CSS.escape(at)}"]`);
    }
    // inside a folded turn: its work comes when it opens (GET /s/:id/work)
    if (!el) {
      const w = [...document.querySelectorAll("#log details.worklog")].find((d) => Number(d.dataset.from) <= Number(at) && Number(at) <= Number(d.dataset.to));
      if (w) {
        const loaded = new Promise((ok) => { const box = w.querySelector(".worklog-in"); box?.addEventListener("htmx:afterSwap", ok, { once: true }); setTimeout(ok, 4000); });
        w.open = true; await loaded;
        el = document.querySelector(`#log [data-idx="${CSS.escape(at)}"]`);
      }
    }
    if (!el) return false;
    el.scrollIntoView({ block: "center", behavior: "instant" }); el.classList.add("found");
    setTimeout(() => el.classList.remove("found"), 2400);
    const u = new URL(location.href); u.searchParams.delete("at"); history.replaceState(null, "", u.pathname + u.search + u.hash);
    return true;
  }
  function filterSidebar(q) {
    q = q.trim().toLowerCase();
    $$("#sbList .proj .sess, #sbList .loose-sess .sess").forEach((s) => { s.hidden = !!q && !s.textContent.toLowerCase().includes(q); });
    $$("#sbList .proj").forEach((p) => { p.hidden = !!q && !p.textContent.toLowerCase().includes(q); });
  }

  // chat width resizer
  document.addEventListener("pointerdown", (e) => {
    const rz = e.target.closest("#rz"); if (!rz || e.button !== 0) return;
    e.preventDefault();
    const app = $("#app"); const stage = $("#stage"); const r = stage.getBoundingClientRect();
    app.classList.add("dragging"); rz.classList.add("active");
    // the pointer belongs to the handle until release — frames (an html page, the browser view) cannot swallow
    // the release, so the drag never sticks and never moves without a pressed button
    try { rz.setPointerCapture(e.pointerId); } catch { /* old browsers */ }
    const move = (ev) => {
      if (!(ev.buttons & 1)) return up();
      const right = app.dataset.chat !== "left"; const w = right ? r.right - ev.clientX : ev.clientX - r.left;
      app.style.setProperty("--chat-w", Math.max(320, Math.min(w, r.width - 360)) + "px");
    };
    const up = () => {
      app.classList.remove("dragging"); rz.classList.remove("active");
      rz.removeEventListener("pointermove", move); rz.removeEventListener("pointerup", up); rz.removeEventListener("pointercancel", up); rz.removeEventListener("lostpointercapture", up);
      removeEventListener("blur", up);
      localStorage.setItem("dh-chat-w", getComputedStyle(app).getPropertyValue("--chat-w"));
    };
    rz.addEventListener("pointermove", move); rz.addEventListener("pointerup", up); rz.addEventListener("pointercancel", up); rz.addEventListener("lostpointercapture", up);
    addEventListener("blur", up);
  });

  // ── tooltips: one fixed layer, never clipped by overflow ──
  const tip = document.createElement("div"); tip.className = "tip"; tip.hidden = true; tip.setAttribute("role", "tooltip");
  let tipFor = null, tipT = 0;
  document.addEventListener("pointerover", (e) => {
    const el = e.target.closest("[data-tooltip]");
    if (!el || el === tipFor) return;
    // data-tooltip-cut: only when that label inside is cut short or hidden (a narrow tab shows just its icon)
    const cut = el.dataset.tooltipCut && el.querySelector(el.dataset.tooltipCut);
    if (cut && cut.clientWidth > 0 && cut.scrollWidth <= cut.clientWidth) return;
    tipFor = el; clearTimeout(tipT);
    tipT = setTimeout(() => {
      if (!document.body.contains(tip)) document.body.appendChild(tip);
      tip.textContent = el.dataset.tooltip; tip.hidden = false;
      const r = el.getBoundingClientRect(); const tr = tip.getBoundingClientRect(); const side = el.dataset.side || "top";
      let x = r.left + r.width / 2 - tr.width / 2, y = side === "bottom" ? r.bottom + 6 : side === "right" ? r.top + r.height / 2 - tr.height / 2 : side === "left" ? r.top + r.height / 2 - tr.height / 2 : r.top - tr.height - 6;
      if (side === "right") x = r.right + 6; if (side === "left") x = r.left - tr.width - 6;
      tip.style.left = Math.max(4, Math.min(x, innerWidth - tr.width - 4)) + "px"; tip.style.top = Math.max(4, y) + "px";
    }, 350);
  });
  document.addEventListener("pointerout", (e) => { if (tipFor && !tipFor.contains(e.relatedTarget)) { clearTimeout(tipT); tipFor = null; tip.hidden = true; } });

  // ── boot ──
  function boot() {
    syncDark();
    const w = localStorage.getItem("dh-chat-w"); if (w && $("#app")) $("#app").style.setProperty("--chat-w", w);
    { const ask = new URLSearchParams(location.search).get("ask"); const cin = $("#cin"); if (ask && cin) { cin.value = ask; autosize(cin); cin.focus(); } }
    // the choice used to live in this browser only: move it to the server once
    if (localStorage.getItem("dh-sb") === "rail" && $("#app") && $("#app").dataset.sb !== "rail") { $("#app").dataset.sb = "rail"; post("/speca/settings/layout", { sb: "rail" }); }
    localStorage.removeItem("dh-sb");
    if ($("#app")?.dataset.sb === "rail" && matchMedia("(max-width: 820px)").matches) $("#app").dataset.sb = "closed";
    sbSet(JSON.parse(sessionStorage.getItem("dh-sb-scroll") || "null")); sbShowCurrent();
    if (new URLSearchParams(location.search).has("tab")) toCanvasM();   // a link to a canvas tab shows it on a phone
    autosize($("#cin")); syncBusy(); restoreOpen(); if (new URLSearchParams(location.search).has("at")) jumpToMessage().then((ok) => { if (!ok) { scrollLogBottom(true); stickToBottom(); } watchOlder(); $("#log")?.setAttribute("data-placed", "1"); }); else { scrollLogBottom(true); stickToBottom(); watchOlder(); $("#log")?.setAttribute("data-placed", "1"); } connect();
    if ($("#cin") && !matchMedia("(max-width: 820px)").matches && document.body.dataset.page === "session") $("#cin").focus();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();

// Subagents open as drawers stacked over their parent chat: each level one more drawer from the right, the chat
// beneath keeping a strip in view. The stack is in the address (?sub=a,b); Esc or the strip closes the top one.
(() => {
  "use strict";
  const msg = (m) => parent.postMessage({ dhSub: m }, location.origin);
  if (document.body.classList.contains("pane")) {
    // inside a drawer: opening a subagent, going back and Esc are the page's that holds the stack
    document.addEventListener("click", (e) => {
      const a = e.target.closest("a[data-sub]"), back = e.target.closest("[data-act=pane-close]");
      if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); msg({ open: a.dataset.sub }); }
      if (back) { e.preventDefault(); e.stopPropagation(); msg({ close: true }); }
    }, true);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !e.defaultPrevented && !e.target.closest?.("input, textarea, select, [contenteditable], dialog[open]")) msg({ close: true }); });
    return;
  }
  const chat = document.getElementById("chat");
  if (!chat) return;
  const stack = [];
  let scrim = null;
  const sync = () => {
    const u = new URL(location.href);
    if (stack.length) u.searchParams.set("sub", stack.map((d) => d.dataset.sub).join(",")); else u.searchParams.delete("sub");
    history.replaceState(history.state, "", u);
    if (!stack.length) { scrim?.remove(); scrim = null; return; }
    if (!scrim) { scrim = document.createElement("button"); scrim.type = "button"; scrim.className = "sub-scrim"; scrim.setAttribute("aria-label", document.documentElement.lang === "ru" ? "Вернуться в чат" : "Back to the chat"); scrim.addEventListener("click", close); }
    scrim.style.setProperty("--i", String(stack.length - 1));
    chat.insertBefore(scrim, stack[stack.length - 1]);
  };
  const open = (id, from = -1) => {
    while (stack.length > from + 1) drop();
    if (stack.some((d) => d.dataset.sub === id)) return sync();
    const d = document.createElement("div");
    d.className = "sub-drawer"; d.dataset.sub = id; d.style.setProperty("--i", String(stack.length));
    const f = document.createElement("iframe"); f.src = `/speca/s/${encodeURIComponent(id)}/pane`; f.title = id;
    d.append(f); chat.append(d); stack.push(d);
    requestAnimationFrame(() => requestAnimationFrame(() => d.classList.add("in")));
    sync();
    f.addEventListener("load", () => f.contentWindow?.focus());
  };
  const drop = () => { const d = stack.pop(); if (!d) return; d.classList.remove("in"); setTimeout(() => d.remove(), 220); };
  function close() { drop(); sync(); (stack[stack.length - 1]?.querySelector("iframe")?.contentWindow ?? window).focus(); }
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-sub]");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation(); open(a.dataset.sub);
  }, true);
  addEventListener("message", (e) => {
    if (e.origin !== location.origin || !e.data?.dhSub) return;
    const m = e.data.dhSub, from = stack.findIndex((d) => d.querySelector("iframe")?.contentWindow === e.source);
    if (m.open) open(m.open, from);
    if (m.close) { while (stack.length > Math.max(0, from)) drop(); sync(); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !stack.length || e.defaultPrevented || document.querySelector("dialog[open]")) return;
    if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
    e.preventDefault(); close();
  });
  for (const id of (new URL(location.href).searchParams.get("sub") || "").split(",").filter(Boolean)) open(id, stack.length - 1);
})();


// Going to another page answers in the same frame: the place it leads to is marked at once and the work area turns
// into its skeleton, exactly where the chat and the canvas are, while the browser fetches that page (which then comes
// with its own heavy parts loading inside it). Registered last: a click someone else handled is left alone.
(() => {
  "use strict";
  const PAGES = /^\/speca\/(s\/[\w-]+$|day$|agents$|saved$|connections$|coordinator$|artifacts$|settings)/;
  let shown = [];
  const clear = () => { shown.forEach((n) => n.remove()); shown = []; document.body.removeAttribute("aria-busy"); };
  function skeleton(region, kind) {
    const r = region.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) return;
    const d = document.createElement("div");
    d.className = `nav-skel nav-skel-${kind}`; d.setAttribute("aria-hidden", "true");
    Object.assign(d.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    d.innerHTML = kind === "chat"
      ? '<span class="skel nav-skel-head"></span><span class="skel skel-line"></span><span class="skel skel-line"></span><span class="skel nav-skel-msg"></span><span class="skel skel-line"></span><span class="skel nav-skel-msg"></span>'
      : '<span class="skel nav-skel-bar"></span><span class="skel nav-skel-page"></span>';
    document.body.append(d); shown.push(d);
  }
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest("a[href]");
    if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download") || "dialog" in a.dataset || "sub" in a.dataset || a.hasAttribute("hx-get") || a.hasAttribute("hx-post")) return;
    const u = new URL(a.href, location.href);
    if (u.origin !== location.origin || !PAGES.test(u.pathname) || (u.pathname === location.pathname && u.search === location.search)) return;
    clear();
    // the place it leads to, marked now (the sidebar's row, a page tab)
    if (a.closest("#sb")) { document.querySelectorAll('#sb [aria-current="true"], #sb [aria-current="page"]').forEach((x) => x.setAttribute("aria-current", "false")); a.setAttribute("aria-current", "true"); }
    if (a.classList.contains("page-tab")) { a.parentElement?.querySelectorAll(".page-tab").forEach((x) => x.setAttribute("aria-selected", String(x === a))); }
    const chat = document.getElementById("chat"), canvas = document.getElementById("canvas");
    if (chat && getComputedStyle(chat).display !== "none") skeleton(chat, "chat");
    if (canvas && getComputedStyle(canvas).display !== "none") skeleton(canvas.querySelector(".cbody") || canvas, "canvas");
    document.body.setAttribute("aria-busy", "true");
    setTimeout(clear, 10_000);   // a page that never came: the old one back
  });
  // back to a page the browser kept: no skeleton over it
  addEventListener("pageshow", (e) => { if (e.persisted) clear(); });
})();
