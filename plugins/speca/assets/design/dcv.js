// Design canvas host: one camera for the whole world (translate + scale; the iframes stay 1:1), the rings, the
// selection bar, the properties panel, menus, comments and the preview, all driven by what the artboards' pickers
// report. Edits are written back by address; the canvas updates in place, so only the artboard that changed reloads.
// Only the artboards near the viewport keep a live frame; the others show their name until the camera comes close.
(() => {
  // the version this script is (its ?v=): a canvas rendered for a newer one waits for it; a newer script takes over
  // the page's canvases without a reload, an older one stops touching them
  const V = (document.currentScript && new URL(document.currentScript.src, location.href).searchParams.get("v")) || "";
  if (window.__dcv?.v === V) { window.__dcv.initAll(); return; }
  const current = () => window.__dcv?.v === V;
  const { esc, icon } = window.dck;
  const csrf = () => { try { return JSON.parse(document.body.getAttribute("hx-headers") || "{}")["x-csrf"] || ""; } catch { return ""; } };
  // a screenshot (the background browser): every frame live, the whole canvas in view, no camera kept
  const SHOT = document.body.classList.contains("shot");
  // LIVE: frames woken at once (the nearest of those in view, not drawn smaller than their preview — so what they cover
  // is bounded by the screen); ALIVE: frames kept at all. A live frame is a whole page the browser rasters again at
  // every zoom step: a big screen must not mean pages far around it too
  const MIN = 0.05, MAX = 8, LIVE = SHOT ? 999 : 12, ALIVE = SHOT ? 999 : 16, KEEP_MS = 60_000, THUMB_W = 480;   // THUMB_W: the previews' widest (core design-library)
  const say = (title, category = "success") => document.dispatchEvent(new CustomEvent("dh-toast", { detail: { title, category } }));
  const post = (url, body) => fetch(url, { method: "POST", headers: { "x-csrf": csrf(), "content-type": "application/json" }, body: JSON.stringify(body) });
  const download = (url, name) => { const a = document.createElement("a"); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); };
  const fileName = (s) => s.replace(/[\\/:*?"<>|]+/g, " ").trim() || "artboard";
  const ago = (iso, L) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? L.justNow : m < 60 ? L.minAgo.replace("{n}", m) : m < 1440 ? L.hAgo.replace("{n}", Math.round(m / 60)) : new Date(iso).toLocaleDateString(); };

  function init(root) {
    if (root.__dcv || (root.dataset.js && root.dataset.js !== V)) return;
    const tab = root.dataset.tab, me = root.dataset.me || "";
    let ro = !!root.dataset.ro, L = JSON.parse(root.dataset.l || "{}"), comments = {}, showResolved = false;
    const stage = root.querySelector(".dcv-stage"), world = root.querySelector(".dcv-world");
    const bar = root.querySelector(".dcv-selbar"), pct = root.querySelector(".dcv-pct"), menuEl = root.querySelector(".dcv-menu"), guides = root.querySelector(".dcv-guides");
    // pages: several sets of artboards, one shown at a time, each with its own camera
    let sheets = JSON.parse(root.dataset.sheets || "[]");
    const firstSheet = () => sheets[0]?.id || "main";
    let sheet = sessionStorage.getItem(`dcv-sheet:${tab}`) || firstSheet();
    if (!sheets.some((p) => p.id === sheet)) sheet = firstSheet();
    const onSheet = (el) => (el.dataset.sheet || firstSheet()) === sheet;
    const camKey = () => `dcv-cam:${tab}${sheet === firstSheet() ? "" : `:${sheet}`}`;
    let cam = SHOT ? null : JSON.parse(sessionStorage.getItem(camKey()) || "null") || null;
    let sel = null;              // the element (or the one artboard) selected: { file, board, info, probe, tids, rings }
    const picked = new Set();    // artboards and notes selected on the canvas (marquee, shift-click)
    let mode = "";               // "" | "comment"
    let popEl = null, popAt = null;   // the open popover and where it points: { board, x, y } in board px
    let panelOn = localStorage.getItem("dcv-panel") !== "0";
    const panel = (window.__dcvPanels?.[V] || window.__dcvPanel)(root, {
      change: (ch, final) => change(ch, final), rollback: () => rollback(), selectTid: (t) => frame(sel?.board)?.postMessage({ __dcvHost: { t: "select", tid: t } }, "*"),
      hoverTid: (t) => { if (sel) frame(sel.board)?.postMessage({ __dcvHost: { t: "hover", tid: t } }, "*"); }, selectBoard: () => sel && selectBoard(sel.board),
      closePanel: () => setPanel(false), menu: (rect, items) => openMenu(rect.left, rect.bottom + 4, items), resizeBoard: (axis, n) => resizeBoard(axis, n),
      attr: (name, value) => act("attr", { name, value }, true),
      // a colour of the selection, everywhere it paints: preview every element, then save them in one edit
      recolor: (uses, value, final) => recolor(uses, value, final),
      selectTids: (tids) => frame(sel?.board)?.postMessage({ __dcvHost: { t: "selectTids", tids } }, "*"),
      setData: async (path, value) => { if (!sel || ro) return; const s = sel, j = await edit(s.board, { op: "data", path, text: String(value) }); if (j) { want.set(s.board, { tid: s.info.tid, item: s.info.within }); reload(s.board, j.v, j.k); } }, boards: () => boards().map((b) => ({ file: b.dataset.file, title: b.dataset.title })),
    });
    const frame = (b) => b?.querySelector("iframe")?.contentWindow;
    const allBoards = () => [...world.querySelectorAll(".dcv-board")];
    const boards = () => allBoards().filter(onSheet);
    const notes = () => [...world.querySelectorAll(".dcv-note")].filter(onSheet);
    // show one page: the others' artboards and notes hidden; its camera (or the whole page fitted)
    const applySheet = (fitIt) => {
      for (const el of world.querySelectorAll(".dcv-board, .dcv-note")) el.classList.toggle("off-sheet", !onSheet(el));
      sessionStorage.setItem(`dcv-sheet:${tab}`, sheet);
      const name = root.querySelector(".dcv-sname");
      if (name) name.textContent = sheets.length > 1 ? (sheets.find((p) => p.id === sheet)?.title || "") : "";
      if (fitIt) {
        const saved = JSON.parse(sessionStorage.getItem(camKey()) || "null");
        if (saved && boards().length) { cam = saved; apply(); } else fit();
        // an empty page's camera is not kept: what comes onto it later is fitted
        if (!boards().length && !notes().length) sessionStorage.removeItem(camKey());
      }
    };
    const goSheet = (id) => { if (id === sheet) return; clear?.(); sheet = id; applySheet(true); };
    const setPanel = (on) => { panelOn = on; localStorage.setItem("dcv-panel", on ? "1" : "0"); root.querySelector('[data-dcv="panel"]').setAttribute("aria-pressed", String(on)); syncPanel(); };
    const syncPanel = (quiet) => { if (panelOn && sel && !ro) panel.show(sel, quiet); else panel.hide(); };
    root.querySelector('[data-dcv="panel"]').setAttribute("aria-pressed", String(panelOn));

    // ── camera ──
    // A gesture only moves one composited layer: `apply` records the camera and draws it once per frame (the
    // transform, the zoom label as text data — a node replaced inside the app re-runs the page's :has() rules over
    // thousands of chat nodes). What repaints the world (the counter-scaled names and lines: --inv), the live frames
    // and the saved camera wait until the camera rests; --inv also follows mid-gesture once the zoom has moved far.
    let liveT = 0, rafId = 0, inv = 0, pctN = -1, moving = false;
    const pctText = pct.firstChild || pct.appendChild(document.createTextNode(""));
    const setInv = () => { const v = 1 / cam.s; if (v === inv) return false; inv = v; world.style.setProperty("--inv", String(v)); labels(); return true; };
    const settle = () => {
      if (!cam) return;
      moving = false; stage.classList.remove("moving"); stageR = null;
      // the names again also when only the text moved (a font come late, a title renamed)
      if (!setInv()) labels();
      sessionStorage.setItem(camKey(), JSON.stringify(cam)); wake();
    };
    const draw = () => {
      rafId = 0;
      world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.s})`;
      const r = inv * cam.s; if (!inv || r > 2 || r < 0.5) setInv();
      const n = Math.round(cam.s * 100); if (n !== pctN) { pctN = n; pctText.data = `${n}%`; }
      if (sel || picked.size > 1) placeBar();
      if (popEl) placePop();
    };
    const apply = (now) => {
      if (!moving) { moving = true; stage.classList.add("moving"); }
      if (now) { cancelAnimationFrame(rafId); draw(); } else if (!rafId) rafId = requestAnimationFrame(draw);
      clearTimeout(liveT); liveT = setTimeout(settle, 140);
    };
    // the stage's place on the page, kept (read once per gesture, not per event)
    let stageR = null;
    const stageRect = () => stageR || (stageR = stage.getBoundingClientRect());
    addEventListener("resize", () => { stageR = null; });
    document.fonts?.ready.then(() => { if (inv) labels(); });
    addEventListener("scroll", () => { stageR = null; }, true);
    // a board's name is counter-scaled (the same size at any zoom): zoomed far out it would grow over the row's
    // title above it — then the title (kept readable, see dcv.css) says it and the name hides
    function labels() {
      const ns = notes().map((n) => ({ x0: n.offsetLeft, y0: n.offsetTop, x1: n.offsetLeft + Math.max(n.offsetWidth, n.scrollWidth), y1: n.offsetTop + n.offsetHeight }));
      const lh = 20 * (inv || 1);
      for (const b of boards()) {
        const x0 = b.offsetLeft, x1 = x0 + b.offsetWidth, y1 = b.offsetTop, y0 = y1 - lh;
        const hit = ns.some((n) => n.x0 < x1 && n.x1 > x0 && n.y0 < y1 && n.y1 > y0);
        if (hit !== b.classList.contains("noname")) b.classList.toggle("noname", hit);
      }
    }
    const bounds = (els = [...boards(), ...notes()]) => {
      if (!els.length) return null;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const e of els) { const x = e.offsetLeft, y = e.offsetTop - (e.classList.contains("dcv-board") ? 24 : 0); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, e.offsetLeft + e.offsetWidth); y1 = Math.max(y1, e.offsetTop + e.offsetHeight); }
      return { x0, y0, x1, y1 };
    };
    let fitLater = null;
    const fit = (els) => {
      // a hidden stage (a phone showing the chat) has no size: fitted once it is shown
      if (!stage.clientWidth) { fitLater = { els }; return; }
      fitLater = null;
      // the version bar sits over the stage's top: what is fitted starts below it
      const top = root.closest(".tab-bare")?.querySelector(".bare-ver") ? 40 : 0;
      const b = bounds(els), W = stage.clientWidth - (panel.open ? 308 : 0), H = stage.clientHeight - top;
      if (!b) { cam = { x: 40, y: 40 + top, s: 1 }; return apply(); }
      const s = Math.min(2, Math.max(MIN, Math.min((W - 96) / (b.x1 - b.x0), (H - 96) / (b.y1 - b.y0))));
      cam = { s, x: (W - (b.x1 - b.x0) * s) / 2 - b.x0 * s, y: top + (H - (b.y1 - b.y0) * s) / 2 - b.y0 * s };
      apply();
    };
    const zoomAt = (f, cx, cy) => { const s = Math.min(MAX, Math.max(MIN, cam.s * f)), k = s / cam.s; cam = { s, x: cx - (cx - cam.x) * k, y: cy - (cy - cam.y) * k }; apply(); };
    const toWorld = (cx, cy) => { const r = stageRect(); return { x: (cx - r.left - cam.x) / cam.s, y: (cy - r.top - cam.y) / cam.s }; };

    // ── live frames: the artboards in view (nearest the middle first, at most LIVE) and the selected one; the rest
    //    show their preview. A frame out of sight for a minute sleeps, and beyond ALIVE the farthest sleep at once ──
    function wake() {
      if (!cam) return;   // not fitted yet (the stage is hidden)
      const W = stage.clientWidth, H = stage.clientHeight, now = Date.now(), cx = W / 2, cy = H / 2, mx = W * 0.1, my = H * 0.1;
      const near = [], awake = [];
      for (const b of boards()) {
        const x = cam.x + b.offsetLeft * cam.s, y = cam.y + b.offsetTop * cam.s, w = b.offsetWidth * cam.s, h = b.offsetHeight * cam.s;
        const d = Math.hypot(x + w / 2 - cx, y + h / 2 - cy);
        // no bigger on screen than its preview (drawn at half size, at most THUMB_W wide): the picture is enough — a live
        // page only when its details show (or it is selected, or comments need its elements)
        const small = !SHOT && !mode && w <= Math.min(THUMB_W, b.offsetWidth / 2) && b.querySelector(".dcv-thumb");
        const inView = x < W + mx && x + w > -mx && y < H + my && y + h > -my;
        // a live frame drawn smaller than its preview shows the preview (kept loaded for a while, not painted)
        const lod = !!small && b !== sel?.board;
        if (lod !== b.classList.contains("lod")) b.classList.toggle("lod", lod);
        if (!small && inView) near.push([b, d]);
        else if (b.dataset.seen && b !== sel?.board && now - Number(b.dataset.seen) > KEEP_MS) sleep(b);
        if (b.querySelector("iframe[src]")) awake.push([b, d]);
      }
      near.sort((a, b) => a[1] - b[1]);
      const keep = new Set(near.slice(0, LIVE).map(([b]) => b));
      if (sel?.board) keep.add(sel.board);
      for (const b of keep) { b.dataset.seen = String(now); load(b); }
      // too many pages open: the farthest of those not wanted now go to sleep
      const extra = awake.filter(([b]) => !keep.has(b)).sort((a, b) => b[1] - a[1]);
      for (let i = 0; i < extra.length && keep.size + extra.length - i > ALIVE; i++) sleep(extra[i][0]);
    }
    // a preview that could not be drawn: the hatching stays (and the frame still wakes when it comes near)
    root.addEventListener("error", (e) => { if (e.target?.classList?.contains("dcv-thumb")) { e.target.parentElement?.classList.remove("pic"); e.target.remove(); } }, true);
    const load = (b) => { const f = b.querySelector("iframe"); if (f && !f.getAttribute("src")) f.src = f.dataset.src; };
    const sleep = (b) => { const f = b.querySelector("iframe"); if (!f?.getAttribute("src")) return; f.removeAttribute("src"); f.replaceWith(f.cloneNode()); b.classList.remove("live"); delete b.dataset.seen; b.querySelectorAll(".dcv-ring, .dcv-pin").forEach((n) => n.remove()); };
    const whenLive = (b) => new Promise((res) => { if (b.classList.contains("live")) return res(); b.__onLive = res; b.dataset.seen = String(Date.now()); load(b); });
    applySheet(false);
    if (cam) apply(); else requestAnimationFrame(() => fit());

    // ── input: ⌘/ctrl+wheel (and pinch) zooms around the cursor, wheel pans; Space, the middle or the right button
    //    drags the view; dragging the background draws a marquee; a board moves by its name, a note by itself ──
    let zoomT = 0;
    const wheel = (zoom, dx, dy, cx, cy) => {
      const r = stageRect();
      if (zoom) { stage.classList.add("zooming"); clearTimeout(zoomT); zoomT = setTimeout(() => stage.classList.remove("zooming"), 160); zoomAt(Math.min(1.25, Math.max(0.8, Math.exp(-dy * 0.01))), cx - r.left, cy - r.top); }
      else { cam.x -= dx; cam.y -= dy; apply(); }
    };
    // the person's own moves: the canvas does not follow the agent's work for a while after one
    let ownMoveAt = 0;
    stage.addEventListener("pointerdown", () => { ownMoveAt = Date.now(); }, true);
    stage.addEventListener("wheel", (e) => { ownMoveAt = Date.now(); e.preventDefault(); wheel(e.ctrlKey || e.metaKey, e.deltaX, e.deltaY, e.clientX, e.clientY); }, { passive: false });
    let drag = null, space = false, noMenu = false;
    const marqEl = root.querySelector(".dcv-marq");
    // two fingers on the stage pinch-zoom around their middle and pan with it
    const touches = new Map(); let pinch = null;
    const two = () => { const [a, b] = [...touches.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
    queueMicrotask(() => stage.addEventListener("pointerdown", (e) => {   // after the stage's own pointerdown below: it wins over a pan begun by the first finger
      if (e.pointerType !== "touch") return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) { drag = null; marqEl.hidden = true; stage.classList.add("panning"); pinch = two(); }
    }));
    addEventListener("pointermove", (e) => {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!pinch || touches.size < 2) return;
      const n = two(), r = stageRect();
      cam.x += n.x - pinch.x; cam.y += n.y - pinch.y;
      zoomAt(pinch.d ? n.d / pinch.d : 1, n.x - r.left, n.y - r.top); pinch = n;
    });
    const lift = (e) => { touches.delete(e.pointerId); if (touches.size < 2 && pinch) { pinch = null; stage.classList.remove("panning"); } };
    addEventListener("pointerup", lift); addEventListener("pointercancel", lift);
    stage.addEventListener("pointerdown", (e) => {
      closeMenu();
      if (e.target.closest(".dcv-pin, .dcv-pop")) return;
      // a handle on the selected artboard's edge: its size, and the content takes the new width as it goes
      const rz = e.target.closest(".dcv-rz");
      if (rz && e.button === 0 && !ro) {
        const b = rz.closest(".dcv-board");
        e.preventDefault(); e.stopPropagation();
        drag = { kind: "resize", el: b, axis: rz.dataset.rz, w: b.offsetWidth, h: b.offsetHeight, x: e.clientX, y: e.clientY, moved: false };
        stage.classList.add("dragging"); return;
      }
      // a board is taken by its name, or by its picture when it shows one (no live page under the pointer)
      const note = e.target.closest(".dcv-note"), name = e.target.closest(".dcv-name") || (e.target.classList?.contains("dcv-board") ? e.target : null);
      if ((note || name) && e.button === 0 && !space && !ro && !e.target.isContentEditable) {
        const elx = note || name.closest(".dcv-board");
        if (e.shiftKey) { toggle(elx); return; }
        // drag what is picked if this is part of it, else just this
        const group = picked.has(elx) ? [...picked] : [elx];
        drag = { kind: "items", el: elx, group: group.map((n) => ({ n, ox: n.offsetLeft, oy: n.offsetTop })), x: e.clientX, y: e.clientY, moved: false, alt: e.altKey };
        stage.classList.add("dragging"); return;
      }
      const onBg = e.target === stage || e.target === world || e.target === guides;
      // a finger on the background pans (a marquee is for a pointer)
      if (space || e.button === 1 || e.button === 2 || (e.pointerType === "touch" && onBg)) {
        if (e.button !== 2) e.preventDefault();
        drag = { kind: "pan", x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, right: e.button === 2, touch: e.pointerType === "touch" }; stage.classList.add("panning"); return;
      }
      if (e.button === 0 && onBg) {
        if (mode === "comment") return setMode("");
        const r = stage.getBoundingClientRect();
        drag = { kind: "marq", x: e.clientX - r.left, y: e.clientY - r.top, add: e.shiftKey, moved: false };
      }
    });
    addEventListener("pointermove", (e) => {
      if (!drag) return;
      if (drag.kind === "pan") { if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 3) { noMenu = drag.right; drag.moved = true; } cam.x = drag.cx + e.clientX - drag.x; cam.y = drag.cy + e.clientY - drag.y; return apply(); }
      if (drag.kind === "marq") {
        const r = stage.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        if (!drag.moved && Math.hypot(x - drag.x, y - drag.y) < 4) return;
        drag.moved = true; drag.box = { x: Math.min(x, drag.x), y: Math.min(y, drag.y), w: Math.abs(x - drag.x), h: Math.abs(y - drag.y) };
        Object.assign(marqEl.style, { left: `${drag.box.x}px`, top: `${drag.box.y}px`, width: `${drag.box.w}px`, height: `${drag.box.h}px` }); marqEl.hidden = false;
        return;
      }
      if (drag.kind === "resize") {
        drag.moved = true;
        const d = drag, f = d.el.querySelector("iframe");
        const w = d.axis === "s" ? d.w : Math.max(40, Math.round(d.w + (e.clientX - d.x) / cam.s)), h = d.axis === "e" ? d.h : Math.max(40, Math.round(d.h + (e.clientY - d.y) / cam.s));
        d.el.style.width = `${w}px`; d.el.style.height = `${h}px`;
        if (f) { f.width = String(w); f.height = String(h); }
        d.el.dataset.size = `${w} × ${h}`; d.nw = w; d.nh = h;
        placeBar(); return;
      }
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 3) return;
      drag.moved = true;
      let dx = (e.clientX - drag.x) / cam.s, dy = (e.clientY - drag.y) / cam.s;
      // snap the moving group's edges and centres to the other artboards' (⌘ turns it off)
      const snap = e.metaKey || e.ctrlKey ? null : snapOf(drag, dx, dy);
      if (snap) { dx += snap.dx; dy += snap.dy; }
      drawGuides(snap?.lines || []);
      for (const g of drag.group) { g.n.style.left = `${Math.round(g.ox + dx)}px`; g.n.style.top = `${Math.round(g.oy + dy)}px`; }
      placeBar();
    });
    addEventListener("pointerup", () => {
      const d = drag; drag = null; stage.classList.remove("panning", "dragging"); drawGuides([]);
      if (d?.kind === "pan" && d.touch && !d.moved && mode !== "comment") clear();   // a tap on the background
      if (!d || d.kind === "pan") return;
      if (d.kind === "resize") { delete d.el.dataset.size; if (d.moved && (d.nw !== d.w || d.nh !== d.h)) layout({ op: "resize", file: d.el.dataset.file, w: d.nw, h: d.nh }); return; }
      if (d.kind === "marq") {
        marqEl.hidden = true;
        if (!d.moved) { if (mode !== "comment") clear(); return; }
        return marqueeSelect(d.box, d.add);
      }
      if (!d.moved) { if (d.el.classList.contains("dcv-board")) selectBoard(d.el); else pickOnly(d.el); return; }
      if (d.alt && d.group.length === 1 && d.el.classList.contains("dcv-board")) {
        // alt-drag copies the artboard to where it was dropped
        const g = d.group[0], x = d.el.offsetLeft, y = d.el.offsetTop; g.n.style.left = `${g.ox}px`; g.n.style.top = `${g.oy}px`;
        return layout({ op: "duplicate", file: d.el.dataset.file, x, y });
      }
      const items = d.group.map((g) => g.n.classList.contains("dcv-board") ? { file: g.n.dataset.file, x: g.n.offsetLeft, y: g.n.offsetTop } : { note: g.n.dataset.note, x: g.n.offsetLeft, y: g.n.offsetTop });
      layout(items.length === 1 && items[0].file ? { op: "move", ...items[0] } : { op: "moveMany", items });
    });
    const snapOf = (d, dx, dy) => {
      const moving = new Set(d.group.map((g) => g.n));
      const box = d.group.reduce((a, g) => ({ x0: Math.min(a.x0, g.ox + dx), y0: Math.min(a.y0, g.oy + dy), x1: Math.max(a.x1, g.ox + dx + g.n.offsetWidth), y1: Math.max(a.y1, g.oy + dy + g.n.offsetHeight) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
      const th = 8 / cam.s, xs = [box.x0, (box.x0 + box.x1) / 2, box.x1], ys = [box.y0, (box.y0 + box.y1) / 2, box.y1];
      let bx = null, by = null;
      for (const b of boards()) {
        if (moving.has(b)) continue;
        const o = { x0: b.offsetLeft, y0: b.offsetTop, x1: b.offsetLeft + b.offsetWidth, y1: b.offsetTop + b.offsetHeight };
        for (const t of [o.x0, (o.x0 + o.x1) / 2, o.x1]) for (const s of xs) { const dd = t - s; if (Math.abs(dd) <= th && (!bx || Math.abs(dd) < Math.abs(bx.d))) bx = { d: dd, at: t, o }; }
        for (const t of [o.y0, (o.y0 + o.y1) / 2, o.y1]) for (const s of ys) { const dd = t - s; if (Math.abs(dd) <= th && (!by || Math.abs(dd) < Math.abs(by.d))) by = { d: dd, at: t, o }; }
      }
      if (!bx && !by) return null;
      const lines = [];
      if (bx) { const y0 = Math.min(box.y0 + (by?.d ?? 0), bx.o.y0), y1 = Math.max(box.y1 + (by?.d ?? 0), bx.o.y1); lines.push({ x: bx.at, y: y0, w: 0, h: y1 - y0 }); }
      if (by) { const x0 = Math.min(box.x0 + (bx?.d ?? 0), by.o.x0), x1 = Math.max(box.x1 + (bx?.d ?? 0), by.o.x1); lines.push({ x: x0, y: by.at, w: x1 - x0, h: 0 }); }
      return { dx: bx?.d ?? 0, dy: by?.d ?? 0, lines };
    };
    const drawGuides = (lines) => { guides.innerHTML = lines.map((l) => `<div class="dcv-guide${l.w ? " h" : " v"}" style="left:${l.x}px;top:${l.y}px;width:${l.w}px;height:${l.h}px"></div>`).join(""); };
    const marqueeSelect = (box, add) => {
      const r = stage.getBoundingClientRect(), hit = [];
      for (const n of [...boards(), ...notes()]) {
        const b = n.getBoundingClientRect(), x = b.left - r.left, y = b.top - r.top;
        if (x < box.x + box.w && x + b.width > box.x && y < box.y + box.h && y + b.height > box.y) hit.push(n);
      }
      if (!add) clear();
      hit.forEach((n) => { picked.add(n); n.classList.add("sel"); });
      afterPick();
    };
    stage.addEventListener("dblclick", (e) => {
      if (ro) return;
      const name = e.target.closest(".dcv-name"), note = e.target.closest(".dcv-note");
      if (name) return inline(name.querySelector("span"), (t) => layout({ op: "rename", file: name.closest(".dcv-board").dataset.file, title: t }));
      if (note) return inline(note, (t) => layout({ op: "note", id: note.dataset.note, text: t }), true);
    });
    stage.addEventListener("contextmenu", (e) => {
      if (e.target.closest("iframe")) return;
      e.preventDefault();
      if (noMenu) { noMenu = false; return; }
      const name = e.target.closest(".dcv-name") || (e.target.classList?.contains("dcv-board") ? e.target : null), note = e.target.closest(".dcv-note");
      if (name) { const b = name.closest(".dcv-board"); if (!picked.has(b) || picked.size < 2) selectBoard(b); return openMenu(e.clientX, e.clientY, picked.size > 1 ? pickedItems() : boardItems()); }
      if (note) { if (!picked.has(note)) pickOnly(note); return openMenu(e.clientX, e.clientY, picked.size > 1 ? pickedItems() : ro ? [] : [{ label: L.m_delNote, danger: 1, k: "⌫", run: () => layout({ op: "removeNote", id: note.dataset.note }) }]); }
      const at = toWorld(e.clientX, e.clientY);
      openMenu(e.clientX, e.clientY, [
        ...(ro ? [] : [{ label: L.m_note, run: () => layout({ op: "note", text: L.noteNew, x: at.x, y: at.y, ...(sheet !== firstSheet() ? { sheet } : {}) }) }, { label: L.m_comment, k: "C", run: () => setMode("comment") }]),
        ...(ro ? [] : [{ label: L.m_repeatEvery, icon: "copies", run: repeatEvery }]),
        { label: L.m_fit, k: "⌘0", run: () => fit() }, { sep: 1 }, { label: L.m_exportAll, icon: "download", run: () => { location.href = `/speca/design/export/${tab}`; } },
      ]);
    });
    // edit a title or a note in place
    const inline = (node, save, multi) => {
      const before = node.innerText; node.contentEditable = "plaintext-only"; node.focus();
      const r = document.createRange(); r.selectNodeContents(node); getSelection().removeAllRanges(); getSelection().addRange(r);
      const end = (keep) => { node.removeAttribute("contenteditable"); node.removeEventListener("keydown", kd); node.removeEventListener("blur", bl); const t = node.innerText.trim(); if (keep && t && t !== before) save(t); else node.innerText = before; };
      const kd = (e) => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); end(false); } if (e.key === "Enter" && (!multi || e.metaKey || e.ctrlKey)) { e.preventDefault(); end(true); } };
      const bl = () => end(true);
      node.addEventListener("keydown", kd); node.addEventListener("blur", bl);
    };

    // ── keys (also those pressed inside an artboard, which the picker forwards) ──
    const keys = (k) => {
      if (k.key === "Escape") { if (!playEl.hidden) return closePlay(); if (popEl) return closePop(); if (mode) return setMode(""); closeMenu(); return clear(); }
      if (!playEl.hidden) { if (k.key === "ArrowRight") playStep(1); if (k.key === "ArrowLeft") playStep(-1); return; }
      if (k.meta && k.key === "0") return fit();
      if (k.shift && (k.key === "@" || k.key === "2" || k.key === "\"")) return fit(sel ? [sel.board] : picked.size ? [...picked] : undefined);
      if (ro) return;
      // one step per press: a held key repeats, and a step still on its way is not stacked
      if (k.meta && (k.key === "z" || k.key === "Z")) { if (!k.repeat) (k.shift ? redo : undo)(); return; }
      if ((k.key === "c" || k.key === "C") && !k.meta && !k.alt && !k.shift) return setMode(mode === "comment" ? "" : "comment");
      if (!sel) { if (picked.size && (k.key === "Backspace" || k.key === "Delete")) removePicked(); return; }
      if (sel.info.tag === "artboard") {
        if (k.key === "Backspace" || k.key === "Delete") return removePicked();
        if (k.meta && (k.key === "d" || k.key === "D")) return layout({ op: "duplicate", file: sel.file });
        return;
      }
      if (k.key === "Backspace" || k.key === "Delete") return act("delete");
      if (k.meta && (k.key === "d" || k.key === "D")) return act("duplicate");
      if (k.alt && k.key === "ArrowUp") return act("move", { dir: "up" });
      if (k.alt && k.key === "ArrowDown") return act("move", { dir: "down" });
      if (k.shift && (k.key === "A" || k.key === "a") && !k.meta) return act("wrap", { layout: "stack" });
      if (k.meta && (k.key === "g" || k.key === "G")) return act(k.shift ? "unwrap" : "group");
      if (k.meta && (k.key === "]" || k.key === "[")) return act("zorder", { z: k.key === "]" ? "front" : "back" });
    };
    const keydown = (e) => {
      if (!root.isConnected) return removeEventListener("keydown", keydown, true);
      if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
      if (e.code === "Space" && !space && root.contains(document.activeElement)) { space = true; stage.classList.add("space"); }
      // the canvas's keys when the focus is in it, or nowhere (after a click in the panel) while something is selected
      const here = root.contains(document.activeElement) || ((document.activeElement === document.body || !document.activeElement) && (sel || picked.size || !playEl.hidden));
      if (!here) return;
      const k = { key: e.key, meta: e.metaKey || e.ctrlKey, shift: e.shiftKey, alt: e.altKey, repeat: e.repeat };
      if ((k.meta && /^[0zd]$/i.test(k.key)) || (k.alt && /^Arrow(Up|Down)$/.test(k.key)) || ((k.key === "Backspace" || k.key === "Delete") && (sel || picked.size))) e.preventDefault();
      keys(k);
    };
    addEventListener("keydown", keydown, true);
    addEventListener("keyup", (e) => { if (e.code === "Space") { space = false; stage.classList.remove("space"); } });

    // ── rings and the selection bar ──
    const boardOf = (win) => boards().find((b) => frame(b) === win);
    // a ring per selected element: the one picked carries its tag, the copies of its tag a lighter ring
    const ring = (board, cls, info, others = []) => {
      const layer = board.querySelector(".dcv-rings");
      layer.querySelectorAll(`.dcv-ring.${cls}`).forEach((n) => n.remove());
      if (!info) return;
      const add = (r, main) => {
        const n = document.createElement("div"); n.className = `dcv-ring ${cls}${main ? "" : " copy"}`;
        Object.assign(n.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
        if (main && cls === "sel") { const t = document.createElement("span"); t.className = "tag"; t.textContent = info.tag; n.append(t); }
        layer.append(n);
      };
      add(info.rect || info, true); others.forEach((r) => add(r, false));
    };
    const addr = () => sel ? (sel.info.tag === "artboard" ? sel.file : `${sel.file}#${sel.info.tid}:${sel.info.path}`) : "";
    const kindName = (k) => L[`k_${k}`] || L.k_box;
    const human = () => sel ? (sel.info.tag === "artboard" ? sel.board.dataset.title : `${sel.board.dataset.title} › ${kindName(sel.info.kind)}${sel.info.text ? ` «${sel.info.text}»` : ""}`) : "";
    const tool = (a, label, ic, tip) => `<button type="button" class="dk-ib" data-dcv="${a}" aria-label="${esc(label)}" data-tooltip="${esc(tip || label)}" data-side="top">${icon(ic)}</button>`;
    function fillBar() {
      if (picked.size > 1) { bar.innerHTML = `<span class="dk-txt">${esc(L.nPicked.replace("{n}", picked.size))}</span>${ro ? "" : tool("remove-picked", L.m_del, "trash", `${L.m_del} · ⌫`)}`; return; }
      if (!sel) return;
      const i = sel.info, many = sel.own?.length > 1, art = i.tag === "artboard";
      // the same elements of the artboard go together; the chip switches to this one alone and back
      const same = i.linkable || 1;
      const chip = !art && !many && same > 1 ? (i.solo
        ? `<button type="button" class="dk-chip" data-dcv="solo" aria-pressed="true" data-tooltip="${esc(L.soloTip.replace(/\{n\}/g, same))}" data-side="top">${icon("one")}${esc(L.solo)}</button>`
        : `<button type="button" class="dk-chip" data-dcv="solo" aria-pressed="false" data-tooltip="${esc(L.sameTip.replace(/\{n\}/g, same))}" data-side="top">${icon("copies")}${esc(L.same.replace("{n}", same))}</button>`) : "";
      bar.innerHTML = `<span class="dk-txt dcv-addr">${esc(many ? L.nElements.replace("{n}", sel.own.length) : human())}</span>${chip}
        <button type="button" class="dk-btn dcv-askb" data-dcv="ask">${icon("msg")}${esc(L.ask)}</button>
        ${art ? tool("play", L.m_play, "play") : ""}${!art && i.textual && !ro && !many ? tool("text", L.m_text, "pencil", `${L.m_text} · ↵`) : ""}${tool("copy", L.m_copy, "link")}${!ro ? tool(art ? "remove-picked" : "remove", L.m_del, "trash", `${L.m_del} · ⌫`) : ""}`;
    }
    function placeBar() {
      if (!sel && picked.size < 2) { bar.hidden = true; return; }
      const sr = stage.getBoundingClientRect();
      let x, y, w;
      if (picked.size > 1) { const b = bounds([...picked]); x = cam.x + b.x0 * cam.s; y = cam.y + b.y0 * cam.s; w = (b.x1 - b.x0) * cam.s; }
      else { const r = sel.info.rect, br = sel.board.getBoundingClientRect(); x = br.left - sr.left + r.x * cam.s; y = br.top - sr.top + r.y * cam.s; w = r.w * cam.s; }
      bar.hidden = false;
      const bw = bar.offsetWidth, bh = bar.offsetHeight, maxX = stage.clientWidth - bw - 8 - (panel.open ? 308 : 0);
      bar.style.left = `${Math.max(8, Math.min(x + (w - bw) / 2, maxX))}px`;
      bar.style.top = `${Math.max(8, y - bh - (sel?.info.tag === "artboard" || picked.size > 1 ? 30 : 26))}px`;
    }
    const afterPick = () => {
      if (picked.size === 1) { const [n] = picked; if (n.classList.contains("dcv-board")) return selectBoard(n); }
      fillBar(); placeBar(); syncPanel();
    };
    function clear() {
      if (sel && sel.info.tag !== "artboard") { ring(sel.board, "sel", null); ring(sel.board, "edit", null); frame(sel.board)?.postMessage({ __dcvHost: { t: "clear" } }, "*"); }
      world.querySelectorAll(".sel").forEach((x) => x.classList.remove("sel"));
      const had = !!sel; picked.clear(); sel = null; placeBar(); syncPanel();
      if (had) shareSel();
    }
    function selectBoard(b) {
      if (sel && (sel.board !== b || sel.info.tag !== "artboard")) clear();
      picked.clear(); world.querySelectorAll(".sel").forEach((x) => x.classList.remove("sel"));
      picked.add(b); b.classList.add("sel");
      sel = { file: b.dataset.file, board: b, info: { tid: -1, path: "", rect: { x: 0, y: 0, w: b.offsetWidth, h: b.offsetHeight }, tag: "artboard", text: "", textual: false } };
      fillBar(); placeBar(); syncPanel(); shareSel();
    }
    const pickOnly = (n) => { clear(); picked.add(n); n.classList.add("sel"); afterPick(); };
    const toggle = (n) => {
      if (sel && sel.info.tag !== "artboard") clear();
      sel = null;
      if (picked.has(n)) { picked.delete(n); n.classList.remove("sel"); } else { picked.add(n); n.classList.add("sel"); }
      afterPick();
    };
    const removePicked = () => {
      const files = [...picked].filter((n) => n.classList.contains("dcv-board")).map((n) => n.dataset.file), ns = [...picked].filter((n) => n.classList.contains("dcv-note")).map((n) => n.dataset.note);
      if (!files.length && !ns.length) return;
      clear(); layout({ op: "removeMany", files, notes: ns });
    };

    // ── writing: the selected elements' style or text, or a structural change ──
    let pending = {}, timer = 0;
    function change(ch, final) {
      if (!sel || ro || sel.info.tag === "artboard") return;
      Object.assign(pending, ch); frame(sel.board)?.postMessage({ __dcvHost: { t: "preview", tids: sel.tids, changes: ch } }, "*");
      clearTimeout(timer);
      if (final) commit(); else timer = setTimeout(commit, 700);
    }
    let recolorT = 0, recolorPending = null;
    function recolor(uses, value, final) {
      if (!sel || ro) return;
      const groups = new Map();
      for (const u of uses) groups.set(u.prop, [...(groups.get(u.prop) || []), u.tid]);
      const batch = [...groups].map(([prop, tids]) => ({ tids: [...new Set(tids)], changes: { [prop]: value } }));
      for (const g of batch) frame(sel.board)?.postMessage({ __dcvHost: { t: "preview", tids: g.tids, changes: g.changes } }, "*");
      recolorPending = { board: sel.board, batch };
      clearTimeout(recolorT);
      const go = async () => { const p = recolorPending; recolorPending = null; if (!p) return; const j = await edit(p.board, { op: "styles", batch: p.batch }); frame(p.board)?.postMessage({ __dcvHost: { t: j ? "settle" : "rollback" } }, "*"); };
      if (final) go(); else recolorT = setTimeout(go, 700);
    }
    function rollback() { clearTimeout(timer); pending = {}; if (sel) frame(sel.board)?.postMessage({ __dcvHost: { t: "rollback" } }, "*"); }
    async function commit() {
      clearTimeout(timer);
      if (!sel || !Object.keys(pending).length) return;
      const changes = pending, s = sel; pending = {};
      const j = await edit(s.board, { op: "style", tids: s.tids, changes });
      frame(s.board)?.postMessage({ __dcvHost: { t: j ? "settle" : "rollback" } }, "*");
    }
    // the edit route answers with the file's new version: same tids (style, one text) → the frame already shows it
    async function edit(b, body) {
      b.dataset.pending = "1";
      try {
        const r = await post(`/speca/design/edit/${tab}`, { file: b.dataset.file, v: b.dataset.v, ...body });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { say(r.status === 409 ? L.stale : L[`err_${j.error}`] || L.notSaved, "error"); if (r.status === 409) reload(b, j.v); return null; }
        b.dataset.v = j.v;
        // the frame shows this already (a style, one text) or reloads to it (act): either way it is this key
        if (j.k) b.dataset.k = j.k;
        return j;
      } finally {
        delete b.dataset.pending;
        if (b.dataset.nextK && b.dataset.nextK !== b.dataset.k) reload(b, null, b.dataset.nextK);
        delete b.dataset.nextK;
      }
    }
    // what a structural action means for this selection: a copy of a repeat is one item of its data; otherwise every
    // selected tag (a part of a repeat is its template: all copies)
    const asItem = () => sel && sel.info.item && !(sel.own?.length > 1);
    const want = new Map();   // board → { tid, item } to select once it reloads
    async function act(op, extra = {}, keepSel) {
      if (!sel || ro || sel.info.tag === "artboard") return;
      await commit();
      const s = sel;
      const body = asItem() && ["delete", "duplicate", "move"].includes(op) ? { op: "item", path: s.info.item, action: op === "move" ? extra.dir : op } : { op, tids: s.own || [s.info.tid], ...extra };
      const j = await edit(s.board, body);
      if (!j) return;
      if (op === "delete" && !keepSel) clear(); else want.set(s.board, { tid: j.select ?? s.info.tid, item: j.item ?? (body.op === "item" ? null : s.info.within) });
      reload(s.board, j.v, j.k);
    }
    // reload one frame: `k` is the render key (the file and what it imports) the server gave, else a fresh one
    function reload(b, v, k) {
      if (v) b.dataset.v = v;
      const f = b.querySelector("iframe"), u = new URL(f.dataset.src, location.href);
      if (k) b.dataset.k = k;
      u.searchParams.set("v", k ? k : `${b.dataset.k}.${Date.now().toString(36)}`); f.dataset.src = u.pathname + u.search;
      b.querySelectorAll(".dcv-ring, .dcv-pin").forEach((n) => n.remove());
      if (f.getAttribute("src")) { b.classList.remove("live"); f.src = f.dataset.src; }
      // its preview follows (drawn again by the server for the new content)
      const th = b.querySelector(".dcv-thumb"); if (th && k) th.src = `${th.dataset.base}&k=${k}`;
    }
    const layout = async (body) => {
      const r = await post(`/speca/design/layout/${tab}`, body);
      if (!r.ok) say(L.notSaved, "error");
      return r.ok ? r.json().catch(() => ({})) : null;
    };
    const resizeBoard = async (axis, n) => {
      if (!sel || !Number.isFinite(n) || n < 40) return;
      const b = sel.board, w = axis === "w" ? n : b.offsetWidth, h = axis === "h" ? n : b.offsetHeight;
      await layout({ op: "resize", file: b.dataset.file, w: Math.round(w), h: Math.round(h) });
    };
    let stepping = false;
    const step = async (dir) => {
      if (stepping) return;
      stepping = true;
      try {
        await commit();
        const r = await fetch(`/speca/canvas/${tab}/${dir}`, { method: "POST", headers: { "x-csrf": csrf() } });
        const why = r.status === 409 ? (await r.json().catch(() => ({}))).reason : null;
        say(r.ok ? (dir === "undo" ? L.undone : L.redone) : r.status === 409 ? (dir === "redo" ? L.nothingRedo : why === "agent" ? L.nothingAgent : why === "conflict" ? L.undoConflict : L.nothing) : L.notSaved, r.ok ? "success" : r.status === 409 ? "info" : "error");
      } finally { setTimeout(() => { stepping = false; }, 350); }
    };
    const undo = () => step("undo"), redo = () => step("redo");

    // ── messages from the artboards ──
    const onMsg = (e) => {
      if (!root.isConnected) return removeEventListener("message", onMsg);
      const m = e.data?.__dcv; if (!m) return;
      if (playFrame && e.source === playFrame.contentWindow) { if (m.t === "nav") openPlay(m.file); if (m.t === "key") keys(m); return; }
      const board = boardOf(e.source); if (!board) return;
      if (m.t === "ready") {
        board.classList.add("live"); board.__onLive?.(); delete board.__onLive;
        panel.tree(board, m);
        if (mode) frame(board)?.postMessage({ __dcvHost: { t: "mode", mode } }, "*");
        locate(board);
        const w = want.get(board); want.delete(board);
        if (w) frame(board)?.postMessage({ __dcvHost: { t: "select", ...w } }, "*");
        else if (sel?.board === board && sel.info.tag !== "artboard") clear();
      }
      if (m.t === "tree") panel.tree(board, m);
      if (m.t === "wheel") { const sr = stageRect(); return wheel(m.zoom, m.dx, m.dy, sr.left + cam.x + (board.offsetLeft + m.x) * cam.s, sr.top + cam.y + (board.offsetTop + m.y) * cam.s); }
      if (m.t === "touch") {
        cam.x += m.dx; cam.y += m.dy;
        if (m.f === 1) return apply();
        return zoomAt(m.f, cam.x + (board.offsetLeft + m.x) * cam.s, cam.y + (board.offsetTop + m.y) * cam.s);
      }
      if (m.t === "pt") return share({ x: Math.round(board.offsetLeft + m.x), y: Math.round(board.offsetTop + m.y) });
      if (m.t === "hover") ring(board, "hov", m, m.rings);
      if (m.t === "hover-off") ring(board, "hov", null);
      if (m.t === "marq") ring(board, "marq", m.rect);
      if (m.t === "drop") ring(board, "drop", m.rect);
      if (m.t === "select" || m.t === "editing") {
        if (sel && sel.board !== board) clear();
        if (picked.size) { world.querySelectorAll(".sel").forEach((x) => x.classList.remove("sel")); picked.clear(); }
        if (sel && !m.quiet && sel.info.tid !== m.tid) { clearTimeout(timer); commit(); }
        sel = { file: board.dataset.file, board, info: m, probe: m.probe || sel?.probe, tids: m.tids || [m.tid], own: m.own || [m.tid], rings: m.rings || [] };
        ring(board, "sel", m, m.rings); ring(board, "hov", null); ring(board, "edit", m.t === "editing" ? m : null);
        if (!m.quiet) { fillBar(); shareSel(); }
        placeBar(); syncPanel(m.quiet);
      }
      if (m.t === "clear" && sel?.board === board) clear();
      if (m.t === "edit-cancel") ring(board, "edit", null);
      if (m.t === "text") {
        ring(board, "edit", null);
        // a template's text (shown with its holes) or a text every copy shares changes them all: the frame reloads
        const many = (sel?.info.copies || 1) > 1, item = sel?.info.within;
        edit(board, { op: "text", tid: m.tid, text: m.text, template: !!m.template, ...(m.html !== undefined ? { html: m.html } : {}) }).then((j) => {
          if (j && (m.template || many || m.structural)) { want.set(board, { tid: m.tid, item }); reload(board, j.v, j.k); } else if (!j) reload(board);
        });
      }
      if (m.t === "reorder") act("reorder", { to: m.to });
      if (m.t === "moved") { Object.assign(pending, { left: m.left, top: m.top }); commit(); }
      if (m.t === "menu" && sel) { const r = board.getBoundingClientRect(), k = r.width / board.offsetWidth; openMenu(r.left + m.x * k, r.top + m.y * k, elementItems()); }
      if (m.t === "key") keys(m);
      if (m.t === "open-component") openBoard(m.file);
      if (m.t === "pin") compose(board, m);
      if (m.t === "located") placePins(board, m.items);
      if (m.t === "exported") { if (m.error) say(L.exportFailed, "error"); else download(m.data, `${fileName(board.dataset.title)}.${m.fmt}`); }
    };
    addEventListener("message", onMsg);
    const openBoard = (file) => { const b = boards().find((x) => x.dataset.file === file); if (!b) return; fit([b]); selectBoard(b); };
    const exportBoard = async (b, fmt) => { await whenLive(b); frame(b)?.postMessage({ __dcvHost: { t: "export", fmt, scale: 2 } }, "*"); };

    // ── menus: what can be done with the selection; a disabled item says why ──
    const elementItems = () => {
      const i = sel.info, editable = !ro, many = sel.own?.length > 1, n = i.copies || 1, item = asItem();
      // a part of a repeat is its template: an action on it changes every copy — say so on the item
      const all = (label) => (!item && n > 1 ? `${label} · ${L.allN.replace("{n}", n)}` : label);
      return [
        { label: L.m_ask, run: ask },
        { label: L.m_comment, k: "C", run: () => setMode("comment") },
        ...(editable ? [
          { sep: 1 },
          { label: L.m_text, k: "↵", disabled: !i.textual || many, why: L.why_text, run: () => frame(sel.board)?.postMessage({ __dcvHost: { t: "edit" } }, "*") },
          { label: item ? L.m_dupItem : all(L.m_dup), k: "⌘D", run: () => act("duplicate") },
          { label: item ? L.m_upItem : all(L.m_up), k: "⌥↑", run: () => act("move", { dir: "up" }) },
          { label: item ? L.m_downItem : all(L.m_down), k: "⌥↓", run: () => act("move", { dir: "down" }) },
          { label: all(L.m_wrap), k: "⇧A", disabled: !!item, why: L.why_repeat, run: () => act("wrap", { layout: "stack" }) },
          { label: all(L.m_wrapRow), disabled: !!item, why: L.why_repeat, run: () => act("wrap", { layout: "row" }) },
          { label: L.m_group, k: "⌘G", disabled: !many || !!item, why: many ? L.why_repeat : L.why_many, run: () => act("group") },
          { label: L.m_ungroup, k: "⇧⌘G", disabled: !i.group || !!item, why: L.why_group, run: () => act("unwrap") },
          { label: L.m_front, k: "⌘]", disabled: !!item, why: L.why_repeat, run: () => act("zorder", { z: "front" }) },
          { label: L.m_back, k: "⌘[", disabled: !!item, why: L.why_repeat, run: () => act("zorder", { z: "back" }) },
          { label: L.m_parent, k: "⇧↵", run: () => frame(sel.board)?.postMessage({ __dcvHost: { t: "parent" } }, "*") },
          { sep: 1 },
          ...(i.import ? [{ label: L.m_openComp, icon: "component", run: () => openBoard(i.import) }, { label: L.m_detach, disabled: i.inRepeat, why: L.why_repeat, run: () => act("detach") }]
            : [{ label: L.m_makeComp, icon: "component", disabled: i.inRepeat || many, why: i.inRepeat ? L.why_repeat : L.why_one, run: makeComponent }]),
          ...(i.twins && !many ? [{ label: L.makeRepeat.replace("{n}", i.twins.count), icon: "copies", run: makeRepeat }] : []),
        ] : []),
        { label: L.m_copy, run: copy },
        ...(editable ? [{ sep: 1 }, { label: item ? L.m_delItem : all(L.m_del), k: "⌫", danger: 1, run: () => act("delete") }] : []),
      ];
    };
    // ── pages: the menu of the pages button (switch, add, rename, delete an empty one) ──
    const sheetName = (p, i) => p.title || L.sheetN.replace("{n}", String(i + 1));
    const sheetItems = () => {
      const list = sheets.length ? sheets : [{ id: firstSheet(), title: "" }];
      const here = (el) => (el.dataset.sheet || firstSheet()) === sheet;
      const empty = !allBoards().some(here) && ![...world.querySelectorAll(".dcv-note")].some(here);
      return [
        { head: L.sheets },
        ...list.map((p, i) => ({ label: sheetName(p, i), icon: p.id === sheet ? "check" : undefined, run: () => goSheet(p.id) })),
        ...(ro ? [] : [{ sep: 1 },
          { label: L.newSheet, run: async () => { const j = await layout({ op: "sheet", title: L.sheetN.replace("{n}", String(list.length + 1)) }); if (j?.id) { wantSheet = j.id; } } },
          ...(list.length > 1 ? [
            { label: L.renameSheet, run: () => { const n = root.querySelector(".dcv-sname"); if (n) inline(n, (t) => layout({ op: "sheet", id: sheet, title: t })); } },
            { label: L.removeSheet, danger: 1, disabled: !empty, why: L.sheetNotEmpty, run: () => layout({ op: "removeSheet", id: sheet }) },
          ] : [])]),
      ];
    };
    let wantSheet = "";   // a page just added: shown once the canvas has it
    const boardItems = () => {
      const b = sel.board, waiting = b.classList.contains("pending");
      return [
        { label: L.m_play, run: () => openPlay(b.dataset.file) },
        { label: L.m_ask, run: ask },
        ...(ro ? [] : [
          { label: L.m_rename, run: () => inline(b.querySelector(".dcv-name span"), (t) => layout({ op: "rename", file: b.dataset.file, title: t })) },
          { label: L.m_dupBoard, k: "⌘D", run: () => layout({ op: "duplicate", file: b.dataset.file }) },
          // to another page of the canvas (the selected artboards along with it)
          ...(sheets.length > 1 ? sheets.filter((p) => p.id !== sheet).map((p) => ({ label: L.toSheet.replace("{name}", sheetName(p, sheets.indexOf(p))), run: () => {
            const files = [...new Set([b, ...[...picked].filter((x) => x.classList?.contains("dcv-board"))].map((x) => x.dataset.file))];
            clear(); layout({ op: "toSheet", files, sheet: p.id });
            // that page fits its artboards next time it is shown
            sessionStorage.removeItem(`dcv-cam:${tab}${p.id === firstSheet() ? "" : `:${p.id}`}`);
          } })) : []),
        ]),
        { label: L.m_zoomTo, k: "⇧2", run: () => fit([b]) },
        ...(ro ? [] : [{ label: L.m_repeatAll, icon: "copies", run: async () => { const j = await edit(b, { op: "repeatAll" }); if (j) { reload(b, j.v, j.k); say(L.repeatsMade.replace("{n}", j.made)); } } }]),
        { label: L.m_copy, run: copy },
        { sep: 1 },
        ...(waiting ? [] : [
        { label: L.m_png, icon: "download", run: () => exportBoard(b, "png") },
        { label: L.m_svg, icon: "download", run: () => exportBoard(b, "svg") },
        { label: L.m_html, icon: "download", run: () => { location.href = `/speca/design/export/${tab}/${encodeURIComponent(b.dataset.file)}`; } }]),
        ...(ro ? [] : [{ sep: 1 }, { label: L.m_delBoard, k: "⌫", danger: 1, run: () => { clear(); layout({ op: "remove", file: b.dataset.file }); } }]),
      ];
    };
    const pickedItems = () => ro ? [] : [{ label: L.m_del, k: "⌫", danger: 1, run: removePicked }];
    function openMenu(x, y, items) {
      if (!items.length) return closeMenu();
      menuEl.innerHTML = window.dck.menu(items);
      menuEl.hidden = false;
      window.dck.place(menuEl, root, x, y);
      menuEl.onclick = (e) => { const b = e.target.closest("[data-i]"); if (!b || b.getAttribute("aria-disabled") === "true") return; closeMenu(); items[Number(b.dataset.i)].run(); };
      menuEl.querySelector(".dk-mi:not([aria-disabled])")?.focus();
    }
    function closeMenu() { menuEl.hidden = true; }
    addEventListener("pointerdown", (e) => { if (!menuEl.hidden && !menuEl.contains(e.target)) closeMenu(); }, true);
    addEventListener("blur", closeMenu);
    menuEl.addEventListener("keydown", (e) => {
      const list = [...menuEl.querySelectorAll(".dk-mi:not([aria-disabled])")], at = list.indexOf(document.activeElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); list[(at + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length]?.focus(); }
      if (e.key === "Escape") { e.stopPropagation(); closeMenu(); stage.focus(); }
    });

    // ── popovers on the stage: naming a component, writing a comment, a comment's thread ──
    function openPop(at, html, onClick, focus) {
      closePop();
      popEl = document.createElement("div"); popEl.className = "dk-pop dcv-pop"; popEl.innerHTML = html; popAt = at;
      stage.append(popEl); placePop();
      popEl.addEventListener("click", onClick);
      popEl.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Escape") { closePop(); stage.focus(); }
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey || e.target.tagName === "INPUT")) { e.preventDefault(); (popEl.querySelector(".dk-primary[data-pop-ok]") ?? popEl.querySelector("[data-pop-ok]"))?.click(); }
      });
      if (focus) popEl.querySelector(focus)?.focus();
    }
    function placePop() {
      if (!popEl || !popAt) return;
      const sr = stage.getBoundingClientRect(), br = popAt.board.getBoundingClientRect(), k = br.width / popAt.board.offsetWidth;
      const x = br.left - sr.left + popAt.x * k, y = br.top - sr.top + popAt.y * k;
      popEl.style.left = `${Math.max(8, Math.min(x + 14, stage.clientWidth - popEl.offsetWidth - 8 - (panel.open ? 308 : 0)))}px`;
      popEl.style.top = `${Math.max(8, Math.min(y - 8, stage.clientHeight - popEl.offsetHeight - 8))}px`;
    }
    function closePop() { popEl?.remove(); popEl = null; popAt = null; }
    addEventListener("pointerdown", (e) => { if (popEl && !popEl.contains(e.target) && !e.target.closest(".dcv-pin")) closePop(); }, true);

    // every artboard: its alike hand-written copies → repeats (one undo step per artboard)
    const repeatEvery = async () => {
      let n = 0;
      for (const b of boards()) {
        const r = await post(`/speca/design/edit/${tab}`, { file: b.dataset.file, v: b.dataset.v, op: "repeatAll" });
        if (!r.ok) continue;
        const j = await r.json(); n += j.made || 0; b.dataset.v = j.v; reload(b, j.v, j.k);
      }
      say(n ? L.repeatsMade.replace("{n}", n) : L.err_no_twins, n ? "success" : "info");
    };
    // hand-written copies → one template and data; the same element is selected again, now with all its copies
    const makeRepeat = async () => {
      if (!sel?.info.twins || ro) return;
      const s = sel, t = s.info.twins, j = await edit(s.board, { op: "repeat", tid: t.tid });
      if (!j) return;
      want.set(s.board, { tid: j.select, item: `${j.key}.${t.index}`, sub: t.sub });
      reload(s.board, j.v, j.k); say(L.repeatMade.replace("{n}", t.count));
    };
    const makeComponent = () => {
      const i = sel.info, s = sel, guess = `${kindName(i.kind)}${i.text ? ` ${i.text.split(" ").slice(0, 3).join(" ")}` : ""}`;
      openPop({ board: s.board, x: i.rect.x + i.rect.w, y: i.rect.y }, `<div class="dk-pop-h"><span class="dk-grow">${esc(L.m_makeComp)}</span></div>
        ${window.dck.input({ value: guess, "data-name": "1", "aria-label": L.compName })}<div class="dk-note">${esc(L.compHint)}</div>
        <div class="dk-pop-f"><span class="dk-grow"></span>${window.dck.btn({ label: L.cancel, "data-pop-x": "1" })}${window.dck.btn({ label: L.create, primary: true, "data-pop-ok": "1" })}</div>`,
      async (e) => {
        if (e.target.closest("[data-pop-x]")) return closePop();
        if (!e.target.closest("[data-pop-ok]")) return;
        const title = popEl.querySelector("[data-name]").value.trim() || guess; closePop();
        const j = await edit(s.board, { op: "componentize", tid: i.tid, title, w: Math.max(40, Math.round(i.rect.w)), h: Math.max(40, Math.round(i.rect.h)) });
        if (j) { want.set(s.board, { tid: i.tid }); reload(s.board, j.v, j.k); say(L.compMade.replace("{name}", title)); }
      }, "[data-name]");
      popEl?.querySelector("[data-name]")?.select();
    };

    // ── comments: pins on elements, a thread each, "send to the agent" ──
    const setMode = (m) => {
      mode = m; stage.classList.toggle("commenting", m === "comment");
      root.querySelector('[data-dcv="comments"]')?.setAttribute("aria-pressed", String(m === "comment"));
      const rb = root.querySelector('[data-dcv="resolved"]'); if (rb) rb.hidden = m !== "comment";
      const cl = root.querySelector('[data-dcv="clear-comments"]'); if (cl) cl.hidden = m !== "comment" || ro;
      for (const b of boards()) frame(b)?.postMessage({ __dcvHost: { t: "mode", mode: m } }, "*");
      if (m === "comment") say(L.commentHint);
    };
    // the comments are the core's (one store for every canvas: /canvas/:tab/comments); a pin keeps what it needs in
    // anchor.design, the anchor's path is the artboard address
    const postForm = (url, data) => fetch(url, { method: "POST", headers: { "x-csrf": csrf() }, body: new URLSearchParams(data) }).then((r) => r.ok).catch(() => false);
    const fromCore = (c) => {
      const d = c.anchor.design || {};
      return { file: d.file || String(c.anchor.path || "").split("#")[0], tid: d.tid ?? -1, path: d.path || "", fp: d.fp ?? c.anchor.text ?? "", fx: c.anchor.fx, fy: c.anchor.fy, px: d.px, py: d.py,
        label: c.label, text: c.body, by: c.mine ? me : c.author, byName: c.mine ? L.you : c.name, at: c.at, resolved: c.resolved, mine: c.mine, sent: c.sent,
        replies: (c.replies || []).map((r) => ({ byName: r.mine ? L.you : r.name, text: r.text, at: r.at })) };
    };
    const loadComments = async () => {
      const r = await fetch(`/speca/canvas/${tab}/comments?all=1`).catch(() => null);
      if (!r?.ok) return;
      comments = Object.fromEntries(((await r.json()).comments || []).map((c) => [c.id, fromCore(c)]));
      for (const b of boards()) locate(b);
      countBadge();
    };
    const openComments = () => Object.entries(comments).filter(([, c]) => showResolved || !c.resolved);
    const countBadge = () => {
      const n = Object.values(comments).filter((c) => !c.resolved).length, b = root.querySelector(".dcv-cbadge"); if (b) { b.textContent = String(n); b.hidden = !n; }
      // the ones kept for later: one press sends them all to the agent
      const kept = Object.values(comments).filter((c) => c.mine && !c.sent && !c.resolved).length, sa = root.querySelector(".dcv-sendall");
      if (sa) { sa.hidden = !kept || ro; sa.querySelector("span").textContent = (L.sendAll || "").replace("{n}", kept); }
    };
    const locate = (b) => {
      const list = openComments().filter(([, c]) => c.file === b.dataset.file);
      b.querySelectorAll(".dcv-pin").forEach((n) => n.remove());
      if (list.length) frame(b)?.postMessage({ __dcvHost: { t: "locate", items: list.map(([id, c]) => ({ id, tid: c.tid, fp: c.fp, fx: c.fx, fy: c.fy })) } }, "*");
    };
    // a pin where its element is now; when the element is gone, where it was put
    const placePins = (b, items) => {
      b.querySelectorAll(".dcv-pin").forEach((n) => n.remove());
      for (const it of items) {
        const c = comments[it.id]; if (!c) continue;
        const x = it.x ?? c.px ?? c.fx * b.offsetWidth, y = it.y ?? c.py ?? c.fy * b.offsetHeight;
        const n = document.createElement("button"); n.type = "button"; n.className = `dcv-pin${c.resolved ? " resolved" : ""}${c.mine && !c.sent && !c.resolved ? " unsent" : ""}`; n.dataset.c = it.id;
        n.style.left = `${x}px`; n.style.top = `${y}px`; n.textContent = (c.byName || "?").slice(0, 1).toUpperCase();
        n.setAttribute("aria-label", c.text.slice(0, 80));
        b.append(n);
      }
    };
    stage.addEventListener("click", (e) => { const p = e.target.closest(".dcv-pin"); if (p) thread(p.closest(".dcv-board"), p.dataset.c); });
    const pinLabel = (b, m) => m.tid < 0 ? b.dataset.title : `${b.dataset.title} › ${kindName(m.kind)}${m.text ? ` «${m.text}»` : ""}`;
    const address = (c) => (c.tid >= 0 ? `${c.file}#${c.tid}:${c.path}` : c.file);
    const compose = (b, m) => {
      const label = pinLabel(b, m), toAgent = localStorage.getItem("dcv-cmt-agent") !== "0";
      openPop({ board: b, x: m.x, y: m.y }, `<div class="dk-pop-h"><span class="dk-grow" title="${esc(label)}">${esc(label)}</span></div>
        ${window.dck.textarea({ placeholder: L.commentPh, "data-text": "1", rows: "3" })}
        <div class="dk-pop-f"><span class="dk-grow"></span>${window.dck.btn({ label: L.add, primary: !toAgent, "data-pop-ok": "add", title: L.addHint })}${window.dck.btn({ label: L.toAgent, icon: "send", primary: toAgent, "data-pop-ok": "send" })}</div>`,
      async (e) => {
        // Enter in the box: the way used last time; a button: that one
        const btn = e.target.closest("[data-pop-ok]"); if (!btn) return;
        const text = popEl.querySelector("[data-text]").value.trim(); if (!text) return;
        const agent = btn.dataset.popOk === "send"; localStorage.setItem("dcv-cmt-agent", agent ? "1" : "0");
        closePop();
        const c = { file: b.dataset.file, tid: m.tid, path: m.path || "", fp: m.fp || "", fx: Math.min(1, Math.max(0, m.fx)), fy: Math.min(1, Math.max(0, m.fy)), px: m.x, py: m.y };
        const ok = await postForm(`/speca/canvas/${tab}/comments`, { body: text, label, path: address(c), text: c.fp, fx: String(c.fx), fy: String(c.fy),
          design: JSON.stringify({ file: c.file, tid: c.tid, path: c.path, fp: c.fp, px: c.px, py: c.py }), ...(agent ? { send: "1" } : {}) });
        if (!ok) return say(L.notSaved || "!", "error");
        if (agent) say(L.sentToAgent);
        await loadComments();
      }, "[data-text]");
    };
    const thread = (b, id) => {
      const c = comments[id]; if (!c) return;
      const entries = [{ who: c.byName, when: ago(c.at, L), text: c.text }, ...(c.replies || []).map((r) => ({ who: r.byName, when: ago(r.at, L), text: r.text }))];
      const pin = b.querySelector(`.dcv-pin[data-c="${id}"]`);
      openPop({ board: b, x: pin ? Number.parseFloat(pin.style.left) : 0, y: pin ? Number.parseFloat(pin.style.top) : 0 }, `<div class="dk-pop-h"><span class="dk-grow" title="${esc(c.label)}">${esc(c.label)}</span>
          ${ro ? "" : window.dck.ib({ icon: "send", label: L.toAgentNow, "data-send": "1" }) + (c.resolved ? window.dck.ib({ icon: "undo", label: L.reopen, "data-reopen": "1" }) : window.dck.ib({ icon: "check", label: L.resolve, "data-resolve": "1" }))}${!ro && c.mine ? window.dck.ib({ icon: "trash", label: L.m_del, "data-del": "1" }) : ""}</div>
        ${entries.map(window.dck.comment).join("")}
        ${ro ? "" : `${window.dck.textarea({ placeholder: L.replyPh, "data-text": "1", rows: "2" })}<div class="dk-pop-f"><span class="dk-grow"></span>${window.dck.btn({ label: L.reply, "data-pop-ok": "1" })}</div>`}`,
      async (e) => {
        const act = (what, data = {}) => postForm(`/speca/canvas/comments/${encodeURIComponent(id)}/${what}`, data);
        if (e.target.closest("[data-send]")) { closePop(); if (await act("send")) say(L.sentToAgent); return; }
        if (e.target.closest("[data-resolve]")) { closePop(); if (await act("resolve")) await loadComments(); return; }
        if (e.target.closest("[data-reopen]")) { closePop(); if (await act("resolve", { undo: "1" })) await loadComments(); return; }
        if (e.target.closest("[data-del]")) { closePop(); if (await act("remove")) await loadComments(); return; }
        if (e.target.closest("[data-pop-ok]")) {
          const text = popEl.querySelector("[data-text]").value.trim(); if (!text) return;
          if (await act("reply", { text })) { await loadComments(); thread(b, id); }
        }
      }, null);
    };
    // the comments change elsewhere too (a colleague, the agent's reply): the core says so on comments:<session>
    root.querySelector(".dcv-clive")?.addEventListener("dh-live", () => loadComments());
    void loadComments();

    const copy = () => { navigator.clipboard?.writeText(addr()); say(L.copied); };
    // "this element" in the chat: a readable label and the exact address the agent resolves
    const ask = () => {
      if (!sel) return;
      // through the app: in full screen the chat comes up (⌘J) with it inside, so the person sees what went in
      if (window.dhCompose) { window.dhCompose(`[${human()}](${addr()})`, { at: "start" }); return; }
      const cin = document.getElementById("cin"); if (!cin) return;
      cin.value = `[${human()}](${addr()}) ${cin.value}`.trimEnd() + " "; cin.dispatchEvent(new Event("input", { bubbles: true })); cin.focus(); cin.setSelectionRange(cin.value.length, cin.value.length);
    };

    // while the agent works, the first waiting artboard says it is being drawn (the chat's head knows)
    const busyT = setInterval(() => {
      if (!root.isConnected) return clearInterval(busyT);
      root.classList.toggle("agent-busy", !!document.querySelector("#chat-head .st-running, #chat-head .st-waiting"));
    }, 1000);
    // ── presence: the others on this canvas — their cursors and selections; ours goes out a few times a second ──
    const liveEl = root.querySelector(".dcv-live"), cursors = root.querySelector(".dcv-cursors"), peersEl = root.querySelector(".dcv-peers");
    let mine = {}, sentAt = 0, sendT = 0;
    const share = (patch, now) => {
      if (!liveEl?.dataset.liveTopic || SHOT) return;
      mine = patch === null ? null : { ...(mine || {}), ...patch };
      clearTimeout(sendT);
      const go = () => { sentAt = Date.now(); post(`/speca/design/presence/${tab}`, { state: mine }).then((r) => (r.ok ? r.json() : null)).then((j) => j && drawPeers(j.people)).catch(() => {}); };
      if (now || Date.now() - sentAt > 250) go(); else sendT = setTimeout(go, 250 - (Date.now() - sentAt));
    };
    const shareSel = () => share(sel ? { file: sel.file, rects: sel.info.tag === "artboard" ? [] : [sel.info.rect, ...(sel.rings || [])].slice(0, 20).map((r) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) })), label: human() } : { file: undefined, rects: undefined, label: undefined }, true);
    const hue = (id) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 6; };
    function drawPeers(people) {
      if (!root.isConnected) return;
      const first = (n) => String(n || "?").split(/\s+/)[0];
      cursors.innerHTML = people.filter((p) => Number.isFinite(p.state.x)).map((p) => `<div class="dcv-peer" style="left:${p.state.x}px;top:${p.state.y}px;--pc:var(--dk-peer-${hue(p.userId)})"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 1l5.5 13 2-5.5L14 6.5Z"/></svg><span>${esc(first(p.name))}</span></div>`).join("");
      world.querySelectorAll(".dcv-ring.peer").forEach((n) => n.remove());
      for (const p of people) {
        const b = p.state.file && boards().find((x) => x.dataset.file === p.state.file); if (!b) continue;
        (p.state.rects || []).forEach((r, i) => {
          const n = document.createElement("div"); n.className = "dcv-ring peer"; n.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;--pc:var(--dk-peer-${hue(p.userId)})`;
          if (!i) { const t = document.createElement("span"); t.className = "tag"; t.textContent = first(p.name); n.append(t); }
          b.querySelector(".dcv-rings").append(n);
        });
      }
      peersEl.innerHTML = people.slice(0, 4).map((p) => `<span class="dcv-av" style="--pc:var(--dk-peer-${hue(p.userId)})" data-tooltip="${esc(p.name)}${p.state.label ? ` · ${esc(p.state.label)}` : ""}" data-side="top">${esc(first(p.name).slice(0, 1).toUpperCase())}</span>`).join("") + (people.length ? '<span class="dk-vsep"></span>' : "");
    }
    stage.addEventListener("pointermove", (e) => { const w = toWorld(e.clientX, e.clientY); share({ x: Math.round(w.x), y: Math.round(w.y) }); });
    stage.addEventListener("pointerleave", () => share({ x: undefined, y: undefined }));
    // the signal is for this element alone: bubbling up it would make #canvas-in re-render the whole canvas
    liveEl?.addEventListener("dh-live", (e) => e.stopPropagation());
    liveEl?.addEventListener("dh-live", () => fetch(`/speca/design/presence/${tab}`).then((r) => (r.ok ? r.json() : null)).then((j) => j && drawPeers(j.people)).catch(() => {}));
    share({}, true);
    const beat = setInterval(() => { if (!root.isConnected) { clearInterval(beat); return; } if (document.visibilityState === "visible") share({}, true); }, 10_000);
    addEventListener("pagehide", () => { if (root.isConnected) fetch(`/speca/design/presence/${tab}`, { method: "POST", keepalive: true, headers: { "x-csrf": csrf(), "content-type": "application/json" }, body: JSON.stringify({ state: null }) }); });

    // ── preview: one artboard at a time, links between artboards navigate ──
    const playEl = root.querySelector(".dcv-play"), playStage = playEl.querySelector(".dcv-play-stage");
    let playFrame = null, playFile = null;
    function openPlay(file) {
      const b = boards().find((x) => x.dataset.file === file); if (!b) return;
      playFile = file; playEl.hidden = false;
      playEl.querySelector(".dcv-play-t").textContent = b.dataset.title;
      const w = b.offsetWidth, h = b.offsetHeight, src = new URL(b.querySelector("iframe").dataset.src, location.href);
      src.searchParams.set("play", "1");
      // the same sandbox as the artboard's frame (core/web/sandbox.ts)
      const sb = b.querySelector("iframe");
      playStage.innerHTML = `<iframe sandbox="${esc(sb.getAttribute("sandbox"))}" allow="${esc(sb.getAttribute("allow") || "")}" referrerpolicy="no-referrer" width="${w}" height="${h}" title="${esc(b.dataset.title)}"></iframe>`;
      playFrame = playStage.querySelector("iframe"); playFrame.src = src.pathname + src.search;
      const k = Math.min(1, (playStage.clientWidth - 48) / w, (playStage.clientHeight - 48) / h);
      playFrame.style.transform = `scale(${k})`; playFrame.style.margin = `${-(h - h * k) / 2}px ${-(w - w * k) / 2}px`;
    }
    const playStep = (d) => { const list = boards().filter((b) => !b.classList.contains("pending")).map((b) => b.dataset.file), i = list.indexOf(playFile); const next = list[i + d]; if (next) openPlay(next); };
    function closePlay() { playEl.hidden = true; playStage.innerHTML = ""; playFrame = null; playFile = null; }

    // ── the bars' buttons ──
    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-dcv]"); if (!b) return;
      const a = b.dataset.dcv, r = stage.getBoundingClientRect();
      if (a === "in") zoomAt(1.25, r.width / 2, r.height / 2);
      if (a === "out") zoomAt(0.8, r.width / 2, r.height / 2);
      if (a === "100") zoomAt(1 / cam.s, r.width / 2, r.height / 2);
      if (a === "fit") fit();
      if (a === "panel") setPanel(!panelOn);
      if (a === "comments") setMode(mode === "comment" ? "" : "comment");
      if (a === "clear-comments") void (async () => {
        const n = Object.values(comments).filter((c) => !c.resolved).length;
        if (!n || !confirm((L.clearAsk || "").replace("{n}", n))) return;
        const r = await fetch(`/speca/canvas/${tab}/comments/resolve`, { method: "POST", headers: { "x-csrf": csrf() } }).catch(() => null);
        if (!r?.ok) return say(L.notSaved || "!", "error");
        closePop(); await loadComments();
      })();
      if (a === "send-all") void (async () => {
        const sa = root.querySelector(".dcv-sendall"); if (sa) sa.disabled = true;
        const r = await fetch(`/speca/canvas/${tab}/comments/send`, { method: "POST", headers: { "x-csrf": csrf() } }).catch(() => null);
        if (sa) sa.disabled = false;
        if (!r?.ok) return say(L.notSaved || "!", "error");
        const { sent } = await r.json(); say((L.sentAll || "").replace("{n}", sent)); await loadComments();
      })();
      if (a === "sheets") { const br = b.getBoundingClientRect(); openMenu(br.left, br.top - 8 - Math.min(320, 36 * (sheets.length + 4)), sheetItems()); }
      if (a === "resolved") { showResolved = !showResolved; root.querySelector('[data-dcv="resolved"]')?.setAttribute("aria-pressed", String(showResolved)); for (const b of boards()) locate(b); }
      if (a === "copy" && sel) copy();
      if (a === "remove") act("delete");
      if (a === "remove-picked") removePicked();
      if (a === "make-repeat") makeRepeat();
      if (a === "solo" && sel) frame(sel.board)?.postMessage({ __dcvHost: { t: "solo", on: !sel.info.solo } }, "*");
      if (a === "play" && sel) openPlay(sel.file);
      if (a === "text" && sel) frame(sel.board)?.postMessage({ __dcvHost: { t: "edit" } }, "*");
      if (a === "ask") ask();
      if (a === "play-close") closePlay();
      if (a === "play-prev") playStep(-1);
      if (a === "play-next") playStep(1);
    });
    new ResizeObserver(() => { stageR = null; if (fitLater && stage.clientWidth) fit(fitLater.els); placeBar(); wake(); }).observe(stage);

    // ── the agent points at an artboard (canvas_show focus): its page, the camera moves there if it is not in full
    // view (smoothly), and it is selected. Once per request (a reload does not jump again), and only a fresh one ──
    const glide = (to) => {
      const from = { ...cam }, t0 = performance.now(), D = 420;
      const step = (now) => { const k = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - k, 3); cam = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, s: from.s + (to.s - from.s) * e }; apply(true); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    };
    let focusedAt = 0;
    const focusOn = (src) => {
      const file = src.dataset.focus, at = Number(src.dataset.focusAt) || 0, key = `dcv-focus:${tab}`, follow = !!src.dataset.follow;
      if (!file || !at || Date.now() - at > 5 * 60_000) return;
      // following the agent's work: not while the person moves around themselves (10 s after their last move)
      if (follow && Date.now() - ownMoveAt < 10_000) return;
      const b = allBoards().find((x) => x.dataset.file === file);
      if (!b) return;
      // done already: a redraw right after (the tab made active) only keeps it selected
      if (Number(sessionStorage.getItem(key) || 0) >= at) { if (!follow && Date.now() - focusedAt < 5000 && !b.classList.contains("sel")) selectBoard(b); return; }
      sessionStorage.setItem(key, String(at)); focusedAt = Date.now();
      if (!onSheet(b)) goSheet(b.dataset.sheet || firstSheet());
      // selected first (when pointed at, not when followed): its panel opens, and the camera fits it into what the
      // panel leaves free
      if (!follow) selectBoard(b);
      if (!stage.clientWidth || !cam) return fit([b]);
      const r = b.getBoundingClientRect(), sr = stage.getBoundingClientRect(), right = sr.right - (panel.open ? 308 : 0);
      const inView = r.left >= sr.left && r.top >= sr.top + 24 && r.right <= right && r.bottom <= sr.bottom && r.width >= (right - sr.left) * 0.25;
      if (!inView) {
        const keep = { ...cam }; fit([b]); const to = { ...cam }; cam = keep; apply(); glide(to);
      }
    };
    requestAnimationFrame(() => focusOn(root));

    // ── in-place update when the canvas re-renders (an agent's write, an undo): keep the frames that did not change ──
    root.__dcv = {
      update(fresh) {
        root.dataset.focus = fresh.dataset.focus || ""; root.dataset.focusAt = fresh.dataset.focusAt || ""; root.dataset.follow = fresh.dataset.follow || "";
        requestAnimationFrame(() => focusOn(fresh));
        root.dataset.l = fresh.dataset.l; root.dataset.ro = fresh.dataset.ro; ro = !!fresh.dataset.ro; L = JSON.parse(fresh.dataset.l || "{}");
        countBadge();
        const prog = root.querySelector(".dcv-prog"), fprog = fresh.querySelector(".dcv-prog"); if (prog && fprog) prog.innerHTML = fprog.innerHTML;
        sheets = JSON.parse(fresh.dataset.sheets || "[]"); root.dataset.sheets = fresh.dataset.sheets || "[]";
        if (!sheets.some((p) => p.id === sheet)) sheet = firstSheet();
        const freshWorld = fresh.querySelector(".dcv-world"), old = new Map(allBoards().map((b) => [b.dataset.file, b]));
        for (const fb of freshWorld.querySelectorAll(".dcv-board")) { const b = old.get(fb.dataset.file); if (b) b.dataset.sheet = fb.dataset.sheet || ""; }
        for (const fb of freshWorld.querySelectorAll(".dcv-board")) {
          const b = old.get(fb.dataset.file); old.delete(fb.dataset.file);
          if (!b) { world.append(fb.cloneNode(true)); continue; }
          // a planned artboard drawn now (or the other way round): the whole frame is new
          if (b.classList.contains("pending") !== fb.classList.contains("pending") || (fb.classList.contains("pending") && b.className !== fb.className)) {
            if (sel?.board === b) clear();
            const nb = fb.cloneNode(true); b.replaceWith(nb);
            if (!nb.classList.contains("pending")) { nb.classList.add("fresh"); setTimeout(() => nb.classList.remove("fresh"), 2400); }
            continue;
          }
          if (!drag?.group?.some((g) => g.n === b)) b.setAttribute("style", fb.getAttribute("style"));
          b.dataset.title = fb.dataset.title;
          const span = b.querySelector(".dcv-name span"); if (!span.isContentEditable) span.textContent = fb.dataset.title;
          const f = b.querySelector("iframe"), nf = fb.querySelector("iframe");
          if (!f || !nf) continue;   // a waiting artboard: nothing in it to keep
          f.width = nf.width; f.height = nf.height; f.title = nf.title;
          if (!b.dataset.pending) b.dataset.v = fb.dataset.v;
          // the frame shows the file and the components it imports: reload when that changed
          if (fb.dataset.k !== b.dataset.k) { if (b.dataset.pending) b.dataset.nextK = fb.dataset.k; else reload(b, fb.dataset.v, fb.dataset.k); }
          else if (b.classList.contains("live")) locate(b);
        }
        for (const b of old.values()) { if (sel?.board === b) clear(); picked.delete(b); b.remove(); }
        world.querySelectorAll(".dcv-note").forEach((n) => { if (!n.isContentEditable && !drag?.group?.some((g) => g.n === n)) { picked.delete(n); n.remove(); } });
        const editing = new Set([...world.querySelectorAll(".dcv-note")].map((n) => n.dataset.note));
        for (const n of freshWorld.querySelectorAll(".dcv-note")) if (!editing.has(n.dataset.note)) world.prepend(n.cloneNode(true));
        const empty = stage.querySelector(".dcv-empty"), fe = fresh.querySelector(".dcv-empty");
        if (empty && !fe) empty.remove(); else if (!empty && fe) stage.append(fe.cloneNode(true));
        if (sel?.info.tag === "artboard") selectBoard(sel.board);
        if (wantSheet && sheets.some((p) => p.id === wantSheet)) { const id = wantSheet; wantSheet = ""; goSheet(id); } else applySheet(false);
        if (inv) labels();
        wake();
      },
    };
  }

  // keep the old tree around the design canvas and only swap what is outside it: moving or replacing an iframe's
  // ancestors would reload every artboard
  function morphAround(oldRoot, newRoot, oldLeaf, newLeaf) {
    const chain = (leaf, top) => { const c = []; for (let n = leaf; n && n !== top; n = n.parentElement) c.push(n); return c; };
    const a = chain(oldLeaf, oldRoot), b = chain(newLeaf, newRoot);
    if (a.length !== b.length || a.some((n, i) => n.tagName !== b[i].tagName)) return false;
    const added = [];
    const sync = (P, Q, keep, fresh) => {
      for (const at of [...P.attributes]) if (!Q.hasAttribute(at.name)) P.removeAttribute(at.name);
      for (const at of [...Q.attributes]) if (P.getAttribute(at.name) !== at.value) P.setAttribute(at.name, at.value);
      const ok = [...P.childNodes], nk = [...Q.childNodes], i = ok.indexOf(keep), j = nk.indexOf(fresh);
      const side = (olds, news, before) => {
        if (olds.length === news.length && olds.every((n, k) => n.isEqualNode(news[k]))) return;
        olds.forEach((n) => n.remove());
        for (const n of news) { const c = document.importNode(n, true); before ? P.insertBefore(c, keep) : P.append(c); if (c.nodeType === 1) added.push(c); }
      };
      side(ok.slice(0, i), nk.slice(0, j), true);
      side(ok.slice(i + 1), nk.slice(j + 1), false);
    };
    for (let k = 0; k < a.length; k++) sync(a[k].parentElement, b[k].parentElement, a[k], b[k]);
    added.forEach((n) => window.htmx?.process(n));
    return true;
  }
  document.addEventListener("htmx:beforeSwap", (e) => {
    if (!current()) return;
    const tgt = e.detail.target; if (!tgt || tgt.id !== "canvas-in" || !e.detail.shouldSwap) return;
    const old = tgt.querySelector(".dcv"); if (!old?.__dcv) return;
    const tpl = document.createElement("template"); tpl.innerHTML = e.detail.serverResponse;
    const nin = tpl.content.querySelector("#canvas-in"), fresh = nin?.querySelector(`.dcv[data-tab="${old.dataset.tab}"]`);
    // new scripts: a plain swap runs them and they take the canvas over (the frames reload once)
    if (!fresh || fresh.dataset.js !== old.dataset.js || !morphAround(tgt, nin, old, fresh)) return;
    e.detail.shouldSwap = false;
    old.__dcv.update(fresh);
    tgt.dispatchEvent(new CustomEvent("htmx:afterSettle", { bubbles: true, detail: { elt: tgt } }));
  });

  window.__dcv = { v: V, initAll: () => document.querySelectorAll(".dcv").forEach(init) };
  window.__dcv.initAll();
  document.addEventListener("htmx:afterSettle", () => { if (current()) window.__dcv.initAll(); });
})();
