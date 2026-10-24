// Comments on canvas tabs (any kind), like comments on claude.ai: the comment button (or C) turns on picking, a click on
// an element opens a box to write in, and the comment is pinned there — sent to the agent as a message with the tab
// and the element as context, or kept for later. Pins stay on the content; a pin opens its thread. A sandboxed page
// (an HTML canvas) picks inside itself (comments-frame.js) and reports over postMessage. Needs cmt-core.js.
(() => {
  const C = window.dhCmt;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const csrf = () => { try { return JSON.parse(document.body.getAttribute("hx-headers") || "{}")["x-csrf"] || ""; } catch { return ""; } };
  const svg = (p) => `<svg class="ic ic-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const IC = { msg: svg('<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>'), list: svg('<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>'), undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'), check: svg('<path d="M20 6 9 17l-5-5"/>'), x: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'), trash: svg('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>'),
    up: svg('<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>'), send: svg('<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>') };
  const TO_AGENT = "dh.cmt.toAgent";

  let root = null, tab = "", L = {}, ro = false, list = [], showAll = false, on = false, layer = null, hover = null, hint = null, pop = null, openId = "", draft = null, framePts = new Map(), raf = 0, loadT = 0;
  // what picks inside the content by itself: a sandboxed page (postMessage) or a live view such as the browser
  // canvas (`data-cmt-provider`, events "dh-cmt-host" in / "dh-cmt" out) — the same messages either way
  const frame = () => root?.querySelector("iframe.sandbox-frame, iframe[data-cmt-frame]:not([hidden]), [data-cmt-provider]:not([hidden])");
  const tellFrame = (m) => { const f = frame(); if (!f) return; if (f.tagName === "IFRAME") f.contentWindow?.postMessage({ dhCmHost: m }, "*"); else f.dispatchEvent(new CustomEvent("dh-cmt-host", { detail: m })); };
  const btn = () => document.querySelector('[data-act="cmt-toggle"]');

  // ── the tab on screen: set up when it (re)appears ──
  function scan() {
    const r = document.querySelector("[data-cmt-tab]");
    if (r === root) return;
    const sameTab = r && r.dataset.cmtTab === tab;
    root = r;
    if (!r) { setMode(false); closePop(); tab = ""; list = []; return; }
    tab = r.dataset.cmtTab; ro = !!r.dataset.cmtRo;
    try { L = JSON.parse(r.dataset.cmtL || "{}"); } catch { L = {}; }
    layer = document.createElement("div"); layer.className = "cmt-layer"; layer.setAttribute("data-cmt-ui", "");
    r.appendChild(layer);
    if (window.ResizeObserver) new ResizeObserver(() => { place(); locateFrame(); }).observe(r);
    r.addEventListener("mousemove", onMove, true);
    r.addEventListener("mouseleave", () => showHover(null));
    r.addEventListener("click", onClick, true);
    for (const t of ["mousedown", "pointerdown"]) r.addEventListener(t, (e) => { if (on && !onlyProvider() && !e.target.closest("[data-cmt-ui]")) e.preventDefault(); }, true);
    r.addEventListener("dh-cmt", (e) => fromProvider(e.detail || {}));
    frame()?.addEventListener("load", () => { if (on) tellFrame({ mode: true, L }); locateFrame(); });
    if (!sameTab) { closePop(); framePts = new Map(); }
    setMode(sameTab && on);
    list = sameTab ? list : [];
    place(); load();
  }

  async function load() {
    const t = tab; if (!t) return;
    const r = await fetch(`/speca/canvas/${t}/comments${showAll ? "?all=1" : ""}`).catch(() => null);
    if (!r?.ok || t !== tab) return;
    list = (await r.json()).comments || [];
    const open = list.filter((c) => !c.resolved).length;
    const n = btn()?.querySelector(".cmt-n");
    if (n) { n.textContent = String(open); n.hidden = !open; }
    drawHint();
    place(); locateFrame();
    if (openId) { const c = list.find((x) => x.id === openId); if (c && pop) thread(c, true); else if (!c) closePop(); }
  }
  const reload = () => { clearTimeout(loadT); loadT = setTimeout(load, 120); };

  // ── pins ──
  function place() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!root || !layer) return;
      const rr = root.getBoundingClientRect(), f = frame(), fr = f?.getBoundingClientRect();
      const pins = [...list, ...(draft ? [{ id: "", draft: true, anchor: draft.anchor, name: "" }] : [])];
      layer.innerHTML = pins.map((c, i) => {
        let x, y;
        if (c.anchor.frame) {
          const p = c.draft ? { x: draft.fx, y: draft.fy } : framePts.get(c.id);
          if (!p || !f || p.x < 0 || p.y < 0 || p.x > f.clientWidth || p.y > f.clientHeight) return "";
          x = fr.left - rr.left + f.clientLeft + p.x; y = fr.top - rr.top + f.clientTop + p.y;
        } else {
          const p = C.pointOf(root, c.anchor); x = p.x - rr.left; y = p.y - rr.top;
        }
        const who = c.draft ? "" : (c.name || "?").split(/\s+/).slice(0, 2).map((w) => w[0]).join("");
        return `<button type="button" class="cmt-pin${c.draft ? " draft" : ""}${c.id && c.id === openId ? " on" : ""}${c.sent ? " sent" : ""}${c.resolved ? " resolved" : ""}${!c.draft && c.mine && !c.sent && !c.resolved ? " unsent" : ""}" data-cmt-ui data-id="${esc(c.id)}" style="left:${Math.round(x)}px;top:${Math.round(y)}px" aria-label="${esc(c.label || L.title)}" title="${esc(c.draft ? "" : `${i + 1}. ${c.body.slice(0, 80)}`)}">${esc(who.toUpperCase())}</button>`;
      }).join("");
    });
  }

  // pins inside a sandboxed page: it says where their points are (again by itself when it scrolls)
  function locateFrame() { const inFrame = list.filter((c) => c.anchor.frame); if (frame()) tellFrame({ locate: inFrame.map((c) => ({ id: c.id, ...c.anchor })) }); }

  // ── picking ──
  function setMode(v) {
    on = !!v && !ro && !!root;
    root?.classList.toggle("cmt-on", on);
    btn()?.setAttribute("aria-pressed", String(on));
    tellFrame({ mode: on, L });
    if (!on) showHover(null);
    if (on && !hint) { hint = document.createElement("div"); hint.className = "cmt-hint"; hint.setAttribute("data-cmt-ui", ""); document.body.appendChild(hint); drawHint(); }
    if (hint) {
      if (!on) { hint.remove(); hint = null; }
      else { const cb = document.getElementById("cbody")?.getBoundingClientRect(); if (cb) { hint.style.left = `${cb.left + cb.width / 2}px`; hint.style.top = `${cb.bottom - 46}px`; } }
    }
  }
  // the hint while commenting, with "show resolved" (theirs dimmed, each can be opened again)
  function drawHint() {
    if (!hint) return;
    const kept = list.filter((c) => c.mine && !c.sent && !c.resolved).length;
    hint.innerHTML = `<span>${esc(L.hint || "")}</span>${list.length ? `<button type="button" class="cmt-hint-btn" data-cmt-ui data-index>${IC.list}${esc((L.list || "").replace("{n}", list.length))}</button>` : ""}<button type="button" class="cmt-hint-btn" data-cmt-ui data-all aria-pressed="${showAll}">${esc(L.showResolved || "")}</button>${list.some((c) => !c.resolved) && !ro ? `<button type="button" class="cmt-hint-btn" data-cmt-ui data-clear-all>${esc(L.clearAll || "")}</button>` : ""}${kept && !ro ? `<button type="button" class="cmt-hint-btn cmt-send-all" data-cmt-ui data-send-all>${IC.send}${esc((L.sendAll || "").replace("{n}", kept))}</button>` : ""}`;
    hint.querySelector("[data-all]").onclick = (e) => { e.stopPropagation(); showAll = !showAll; drawHint(); reload(); };
    const ix = hint.querySelector("[data-index]");
    if (ix) ix.onclick = (e) => { e.stopPropagation(); index ? closeIndex() : openIndex(ix); };
    const ca = hint.querySelector("[data-clear-all]");
    if (ca) ca.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm((L.clearAsk || "").replace("{n}", list.filter((c) => !c.resolved).length))) return;
      const r = await fetch(`/speca/canvas/${tab}/comments/resolve`, { method: "POST", headers: { "x-csrf": csrf() } }).catch(() => null);
      if (!r?.ok) { window.dhToast?.(L.title, "", "error"); return; }
      closePop(); if (!showAll) list = []; place(); reload();
    };
    const sa = hint.querySelector("[data-send-all]");
    if (sa) sa.onclick = async (e) => {
      e.stopPropagation(); sa.disabled = true;
      const r = await fetch(`/speca/canvas/${tab}/comments/send`, { method: "POST", headers: { "x-csrf": csrf() } }).catch(() => null);
      if (!r?.ok) { sa.disabled = false; window.dhToast?.(L.title, "", "error"); return; }
      const { sent } = await r.json();
      window.dhToast?.((L.sentAll || "").replace("{n}", sent), "", "success"); window.dhShowChat?.(); reload();
    };
  }
  // ── all comments of the tab in one list (the design system's menu list): each opens its thread — also those whose
  // pin the page covers or that are scrolled away; the unsent ones go to the agent together from here ──
  let index = null;
  function closeIndex() { index?.remove(); index = null; }
  // `head`: opened from the comments button (top of the tab) — then it also turns commenting on and off, and opens
  // under the button. In the Speca app a page is a native view over the window: only menus and dialogs make it step
  // aside, so the bar at the bottom of comment mode stayed under the page, and the button seemed to do nothing.
  function openIndex(at, head = false) {
    closeIndex(); closePop();
    const kept = list.filter((c) => c.mine && !c.sent && !c.resolved).length;
    const m = document.createElement("div"); m.className = "menu menu-pop cmt-index"; m.setAttribute("data-cmt-ui", ""); m.setAttribute("role", "menu");
    // mine can be ticked (the number turns into a box on hover, all show once one is ticked) and deleted together
    const item = (c, i) => `<div class="menu-i" role="menuitem" tabindex="-1" data-id="${esc(c.id)}"${c.mine && !ro ? " data-mine" : ""}><span class="cmt-ix-lead"><span class="cmt-ix-n">${i + 1}</span>${c.mine && !ro ? `<input type="checkbox" class="checkbox cmt-ix-c" aria-label="${esc(c.body.slice(0, 60))}">` : ""}</span><span class="menu-t"><b>${esc(c.body)}</b><small>${esc([c.resolved ? L.resolvedMark : c.sent ? L.sentMark : c.mine ? L.unsent : c.name, c.label || L.page].filter(Boolean).join(" · "))}</small></span></div>`;
    m.innerHTML = `${head && !ro ? `<button type="button" class="menu-i" role="menuitemcheckbox" aria-checked="${on}" data-pick>${IC.msg}<span class="grow">${esc(L.pick || "")}</span>${on ? IC.check : ""}</button><hr>` : ""}${list.length ? `<div class="menu-list divided">${list.map(item).join("")}</div>` : `<div class="menu-none">${esc(L.listEmpty || "")}</div>`}${(kept || list.some((c) => c.mine)) && !ro ? `<hr><div class="cmt-ix-foot"><span class="cmt-ix-sel">${list.some((c) => c.mine) ? `<button type="button" class="btn" data-variant="ghost" data-size="sm" data-sel-all>${esc(L.selectAll || "")}</button>` : ""}</span>${kept ? `<button type="button" class="btn" data-size="sm" data-send-all>${IC.send}${esc((L.sendAll || "").replace("{n}", kept))}</button>` : ""}</div>` : ""}`;
    document.body.appendChild(m); index = m;
    const boxes = () => [...m.querySelectorAll(".cmt-ix-c")];
    // what is ticked: the foot offers deleting them (and clearing the ticks) instead of "select all"
    const selDraw = () => {
      const n = boxes().filter((b) => b.checked).length, slot = m.querySelector(".cmt-ix-sel");
      m.classList.toggle("picking", n > 0);
      if (slot) slot.innerHTML = n ? `<button type="button" class="btn" data-variant="ghost" data-size="icon-sm" data-del aria-label="${esc((L.removeN || "").replace("{n}", n))}" data-tooltip="${esc((L.removeN || "").replace("{n}", n))}" data-side="top">${IC.trash}</button><button type="button" class="btn" data-variant="ghost" data-size="sm" data-sel-none>${esc(L.unselect || "")}</button>` : `<button type="button" class="btn" data-variant="ghost" data-size="sm" data-sel-all>${esc(L.selectAll || "")}</button>`;
    };
    m.addEventListener("change", (e) => { if (e.target.closest(".cmt-ix-c")) selDraw(); });
    const r = at.getBoundingClientRect();
    const below = r.top < innerHeight / 2;
    m.style.left = `${Math.max(8, Math.min(below ? r.right - m.offsetWidth : r.left + r.width / 2 - m.offsetWidth / 2, innerWidth - m.offsetWidth - 8))}px`;
    m.style.top = below ? `${r.bottom + 6}px` : `${Math.max(8, r.top - m.offsetHeight - 8)}px`;
    m.style.setProperty("--ox", below ? "100%" : "50%"); m.style.setProperty("--oy", below ? "0%" : "100%");
    m.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (e.target.closest("[data-pick]")) { closeIndex(); setMode(!on); return; }
      // ticking: not opening the thread
      if (e.target.closest(".cmt-ix-c")) { selDraw(); return; }
      if (e.target.closest("[data-sel-all]")) { const all = boxes(), on2 = !all.every((b) => b.checked); all.forEach((b) => { b.checked = on2; }); selDraw(); return; }
      if (e.target.closest("[data-sel-none]")) { boxes().forEach((b) => { b.checked = false; }); selDraw(); return; }
      if (e.target.closest("[data-del]")) {
        const ids = boxes().filter((b) => b.checked).map((b) => b.closest("[data-id]").dataset.id);
        if (!ids.length || !confirm((L.removeAsk || "").replace("{n}", ids.length))) return;
        const fd = new FormData(); fd.append("ids", ids.join(","));
        const res = await fetch(`/speca/canvas/${tab}/comments/remove`, { method: "POST", headers: { "x-csrf": csrf() }, body: fd }).catch(() => null);
        if (!res?.ok) { window.dhToast?.(L.title, "", "error"); return; }
        const { removed } = await res.json();
        list = list.filter((c) => !ids.includes(c.id)); closeIndex(); place(); reload();
        window.dhToast?.((L.removedN || "").replace("{n}", removed), "", "success");
        return;
      }
      const it = e.target.closest(".menu-i[data-id]");
      if (it) { const c = list.find((x) => x.id === it.dataset.id); closeIndex(); if (c) { tellFrame({ reveal: c.id }); thread(c); } return; }
      const sa = e.target.closest("[data-send-all]"); if (!sa) return;
      sa.disabled = true;
      const res = await fetch(`/speca/canvas/${tab}/comments/send`, { method: "POST", headers: { "x-csrf": csrf() } }).catch(() => null);
      if (!res?.ok) { sa.disabled = false; window.dhToast?.(L.title, "", "error"); return; }
      const { sent } = await res.json();
      closeIndex(); window.dhToast?.((L.sentAll || "").replace("{n}", sent), "", "success"); window.dhShowChat?.(); reload();
    });
  }
  document.addEventListener("pointerdown", (e) => { if (index && !e.target.closest('.cmt-index, [data-index], [data-act="cmt-toggle"]')) closeIndex(); }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && index) { e.stopPropagation(); closeIndex(); } }, true);
  function showHover(el) {
    if (!layer) return;
    if (!el || el === root) { hover?.remove(); hover = null; return; }
    if (!hover || !hover.isConnected) { hover = document.createElement("div"); hover.className = "cmt-hover"; hover.setAttribute("data-cmt-ui", ""); root.appendChild(hover); }
    const rr = root.getBoundingClientRect(), r = el.getBoundingClientRect();
    Object.assign(hover.style, { left: `${r.left - rr.left}px`, top: `${r.top - rr.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  }
  // a live view picks only inside itself (its own bar — the address field — is not commented on)
  const onlyProvider = () => !!root?.dataset.cmtProviderOnly;
  function onMove(e) {
    if (!on || onlyProvider()) return;
    if (e.target.closest("[data-cmt-ui]") || e.target.matches("iframe.sandbox-frame")) return showHover(null);
    showHover(C.pickable(e.target, root));
  }
  function onClick(e) {
    const pin = e.target.closest(".cmt-pin");
    if (pin) { e.preventDefault(); e.stopPropagation(); const c = list.find((x) => x.id === pin.dataset.id); if (c) thread(c); return; }
    if (!on || onlyProvider() || e.target.closest("[data-cmt-ui]")) return;
    e.preventDefault(); e.stopPropagation();
    const el = C.pickable(e.target, root) || root;
    compose(C.anchorAt(el, root, e.clientX, e.clientY, L), e.clientX, e.clientY);
  }
  addEventListener("message", (e) => {
    const f = frame(); if (!f || f.tagName !== "IFRAME" || e.source !== f.contentWindow) return;
    if (e.data && e.data.dhCm) fromProvider(e.data.dhCm);
  });
  function fromProvider(m) {
    const f = frame(); if (!f) return;
    if (m.ready) { if (on) tellFrame({ mode: true, L }); locateFrame(); }
    if (m.located) { framePts = new Map(m.located.map((p) => [p.id, p])); place(); }
    if (m.esc) { if (pop) closePop(); else setMode(false); }
    // a pin the live view shows itself was pressed (the Speca app's browser tab)
    if (m.open) { const c = list.find((x) => x.id === m.open); if (c) thread(c); }
    if (m.pick && on) {
      const fr = f.getBoundingClientRect(), { x, y, label, ...a } = m.pick;
      compose({ ...a, label, frame: true }, fr.left + f.clientLeft + x, fr.top + f.clientTop + y, { fx: x, fy: y });
    }
  }

  // ── popovers: a new comment, a thread ──
  function closePop() { pop?.remove(); pop = null; openId = ""; if (draft) { draft = null; } place(); }
  function popAt(html, x, y) {
    pop?.remove();
    pop = document.createElement("div"); pop.className = "cmt-pop"; pop.setAttribute("data-cmt-ui", ""); pop.setAttribute("role", "dialog");
    pop.innerHTML = html; document.body.appendChild(pop);
    const w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = `${Math.max(8, Math.min(x + 14, innerWidth - w - 8))}px`;
    pop.style.top = `${Math.max(8, Math.min(y - 12, innerHeight - h - 8))}px`;
    return pop;
  }
  function compose(anchor, x, y, framePt) {
    const { label, ...a } = anchor;
    // a comment being written is not thrown away by a click elsewhere
    const busy = draft && pop?.querySelector("textarea");
    if (busy?.value.trim()) { busy.focus(); return; }
    closePop();
    draft = { anchor: { ...a, label }, ...(framePt || {}) };
    const toAgent = localStorage.getItem(TO_AGENT) !== "0";
    const b = (send, main) => `<button type="button" class="btn" data-size="sm"${main ? "" : ' data-variant="outline"'} data-go="${send ? "send" : "add"}"${send ? "" : ` data-tooltip="${esc(L.addHint || "")}" data-side="bottom"`} disabled>${send ? IC.send : ""}${esc(send ? L.toAgent : L.add)}</button>`;
    const p = popAt(`<div class="cmt-where">${esc(label)}</div>
      <textarea class="textarea" rows="3" placeholder="${esc(L.ph)}" aria-label="${esc(L.ph)}"></textarea>
      <div class="cmt-foot"><span class="grow"></span>${b(false, !toAgent)}${b(true, toAgent)}</div>`, x, y);
    place();
    const ta = p.querySelector("textarea"), gos = [...p.querySelectorAll("[data-go]")], t = tab;
    ta.focus();
    ta.addEventListener("input", () => { for (const g of gos) g.disabled = !ta.value.trim(); });
    let sendIt = toAgent;
    const submit = async () => {
      const body = ta.value.trim(); if (!body) return;
      localStorage.setItem(TO_AGENT, sendIt ? "1" : "0");
      const cb = { checked: sendIt };
      for (const g of gos) g.disabled = true; const go = { set disabled(v) { for (const g of gos) g.disabled = v; } };
      const fd = new FormData();
      Object.entries({ body, path: a.path, text: a.text, fx: a.fx, fy: a.fy, label, frame: a.frame ? "1" : "", url: a.url || "", info: a.info || "", send: cb.checked ? "1" : "" }).forEach(([k, v]) => fd.append(k, String(v ?? "")));
      const r = await fetch(`/speca/canvas/${t}/comments`, { method: "POST", headers: { "x-csrf": csrf() }, body: fd }).catch(() => null);
      if (!r?.ok) { go.disabled = false; window.dhToast?.(L.title, "", "error"); return; }
      const c = await r.json();
      draft = null; closePop(); list = [...list, c]; place(); reload();
      if (cb.checked) window.dhShowChat?.();
      if (cb.checked) window.dhToast?.(L.sent, "", "success");
    };
    for (const g of gos) g.addEventListener("click", () => { sendIt = g.dataset.go === "send"; submit(); });
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendIt = toAgent; submit(); } });
  }
  function ago(iso) {
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    return m < 1 ? L.justNow : m < 60 ? L.minAgo.replace("{n}", m) : m < 60 * 24 ? L.hAgo.replace("{n}", Math.round(m / 60)) : new Date(iso).toLocaleDateString();
  }
  function thread(c, keep) {
    const pinEl = layer?.querySelector(`.cmt-pin[data-id="${c.id}"]`), pr = pinEl?.getBoundingClientRect();
    const typed = keep ? pop?.querySelector("textarea")?.value : "", focused = keep && document.activeElement === pop?.querySelector("textarea");
    const entry = (who, at, text) => `<div class="cmt-e"><div class="cmt-eh"><b>${esc(who)}</b><span>${esc(ago(at))}</span></div><div class="cmt-et">${esc(text)}</div></div>`;
    const html = `<div class="cmt-ph"><div class="cmt-where">${esc(c.label || L.page)}</div>
        ${ro ? "" : c.resolved ? `<button type="button" class="btn" data-variant="ghost" data-size="icon-sm" data-reopen aria-label="${esc(L.reopen)}" data-tooltip="${esc(L.reopen)}" data-side="bottom">${IC.undo}</button>`
          : `<button type="button" class="btn" data-variant="ghost" data-size="icon-sm" data-resolve aria-label="${esc(L.resolve)}" data-tooltip="${esc(L.resolve)}" data-side="bottom">${IC.check}</button>`}
        ${c.mine && !ro ? `<button type="button" class="btn" data-variant="ghost" data-size="icon-sm" data-remove aria-label="${esc(L.remove)}" data-tooltip="${esc(L.remove)}" data-side="bottom">${IC.trash}</button>` : ""}
        <button type="button" class="btn" data-variant="ghost" data-size="icon-sm" data-close aria-label="×">${IC.x}</button></div>
      <div class="cmt-list">${entry(c.mine ? L.you : c.name, c.at, c.body)}${c.replies.map((r) => entry(r.mine ? L.you : r.author === "agent" ? r.name || L.agent : r.name, r.at, r.text)).join("")}</div>
      ${c.sent ? `<div class="cmt-sent">${IC.send}${esc(L.sent)}</div>` : ro ? "" : `<button type="button" class="cmt-send" data-send>${IC.send}${esc(L.sendNow)}</button>`}
      ${ro ? "" : `<div class="cmt-reply"><textarea class="textarea" rows="1" placeholder="${esc(L.replyPh)}" aria-label="${esc(L.reply)}"></textarea><button type="button" class="btn" data-size="icon-sm" data-go aria-label="${esc(L.reply)}" disabled>${IC.up}</button></div>`}`;
    const x = pr ? pr.right : innerWidth / 2, y = pr ? pr.top : innerHeight / 3;
    const p = keep && pop ? (pop.innerHTML = html, pop) : (closePop(), popAt(html, x, y));
    openId = c.id; place();
    const act = async (path, body) => {
      const fd = new FormData(); Object.entries(body || {}).forEach(([k, v]) => fd.append(k, v));
      const r = await fetch(`/speca/canvas/comments/${c.id}/${path}`, { method: "POST", headers: { "x-csrf": csrf() }, body: fd }).catch(() => null);
      if (!r?.ok) window.dhToast?.(L.title, "", "error");
      return !!r?.ok;
    };
    p.querySelector("[data-close]").onclick = closePop;
    const res = p.querySelector("[data-resolve]"); if (res) res.onclick = async () => { if (await act("resolve")) { if (!showAll) list = list.filter((x) => x.id !== c.id); closePop(); reload(); } };
    const reo = p.querySelector("[data-reopen]"); if (reo) reo.onclick = async () => { if (await act("resolve", { undo: "1" })) { closePop(); reload(); } };
    const rm = p.querySelector("[data-remove]"); if (rm) rm.onclick = async () => { if (await act("remove")) { list = list.filter((x) => x.id !== c.id); closePop(); reload(); } };
    const sd = p.querySelector("[data-send]"); if (sd) sd.onclick = async () => { sd.disabled = true; if (await act("send")) { window.dhToast?.(L.sent, "", "success"); window.dhShowChat?.(); reload(); } else sd.disabled = false; };
    const ta = p.querySelector(".cmt-reply textarea"), go = p.querySelector(".cmt-reply [data-go]");
    if (ta) {
      if (typed) ta.value = typed;
      go.disabled = !ta.value.trim();
      ta.addEventListener("input", () => { go.disabled = !ta.value.trim(); ta.style.height = "auto"; ta.style.height = `${Math.min(140, ta.scrollHeight)}px`; });
      const send = async () => { const text = ta.value.trim(); if (!text) return; go.disabled = true; if (await act("reply", { text })) { ta.value = ""; reload(); } else go.disabled = false; };
      go.onclick = send;
      ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
      if (!keep || focused) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    }
    p.querySelector(".cmt-list").scrollTop = 1e6;
  }

  // ── wiring ──
  document.addEventListener("click", (e) => {
    const b = e.target.closest('[data-act="cmt-toggle"]');
    // with comments on the tab: their menu (the list, sending, commenting on and off); without: commenting at once
    if (b) { e.preventDefault(); scan(); if (index) { closeIndex(); return; } if (list.length) openIndex(b, true); else setMode(!on); return; }
  });
  // outside the popover and its pin: close it (an unsent draft is dropped only if empty)
  document.addEventListener("mousedown", (e) => {
    if (!pop || e.target.closest(".cmt-pop, .cmt-pin")) return;
    const ta = pop.querySelector("textarea");
    if (draft && ta?.value.trim()) return;
    closePop();
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && (pop || on)) { if (pop) closePop(); else setMode(false); e.stopPropagation(); return; }
    const t = e.target;
    if ((e.key === "c" || e.key === "C") && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && root && !ro && !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !t.isContentEditable && !document.querySelector("dialog[open]")) setMode(!on);
  }, true);
  // the comments' live signal: refresh the pins only — it must not reach #canvas-in, which would re-render the tab
  document.addEventListener("dh-live", (e) => { if (e.target.classList?.contains("cmt-live")) { e.stopPropagation(); reload(); } }, true);
  document.addEventListener("htmx:afterSettle", () => { scan(); place(); });
  document.addEventListener("scroll", () => { if (pop && openId) { const pe = layer?.querySelector(`.cmt-pin[data-id="${openId}"]`); if (pe) { const r = pe.getBoundingClientRect(); pop.style.top = `${Math.max(8, Math.min(r.top - 12, innerHeight - pop.offsetHeight - 8))}px`; } } }, true);
  addEventListener("resize", () => { place(); locateFrame(); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan); else scan();
})();
