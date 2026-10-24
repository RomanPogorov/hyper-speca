// Comments inside a sandboxed page (an HTML canvas): the shell can't reach into the frame, so the page itself shows
// what the pointer is over, reports a click as an anchor and says where the shell's pins are. Needs cmt-core.js.
// Messages: shell → page {dhCmHost: {mode, L} | {locate: [anchor + id]}}; page → shell {dhCm: {pick} | {located} | {esc} | {ready}}.
(() => {
  const C = window.dhCmt, root = () => document.body;
  let on = false, L = {}, list = [], box = null, raf = 0;
  // a native preview knows Speca's origin and talks only to it; a sandboxed page (opaque origin) cannot know it
  const post = (m) => parent.postMessage({ dhCm: m }, window.__dhParent || "*");
  function hl(el) {
    if (!box) {
      box = document.createElement("div"); box.setAttribute("data-cmt-ui", "");
      box.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;border-radius:4px;box-shadow:0 0 0 2px rgb(59 130 246 / .9);background:rgb(59 130 246 / .08);display:none";
      document.documentElement.appendChild(box);
    }
    if (!el) { box.style.display = "none"; return; }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: "block", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  }
  function locate() {
    raf = 0;
    if (!list.length) return;
    post({ located: list.map((a) => { const p = C.pointOf(root(), a); return { id: a.id, x: p.x, y: p.y }; }), w: innerWidth, h: innerHeight });
  }
  const later = () => { if (!raf) raf = requestAnimationFrame(locate); };
  addEventListener("message", (e) => {
    if (e.source !== parent || (window.__dhParent && e.origin !== window.__dhParent)) return;
    const m = e.data && e.data.dhCmHost; if (!m) return;
    if ("mode" in m) { on = !!m.mode; L = m.L || L; document.documentElement.style.cursor = on ? "crosshair" : ""; if (!on) hl(null); }
    if (m.locate) { list = m.locate; locate(); }
  });
  document.addEventListener("mousemove", (e) => { if (on) hl(C.pickable(e.target, root())); }, true);
  document.addEventListener("mouseleave", () => hl(null));
  for (const t of ["mousedown", "pointerdown", "mouseup"]) document.addEventListener(t, (e) => { if (on) { e.preventDefault(); e.stopPropagation(); } }, true);
  document.addEventListener("click", (e) => {
    if (!on) return;
    e.preventDefault(); e.stopPropagation();
    const el = C.pickable(e.target, root()) || root();
    // what the element is, for the agent (and, in a native preview, the page's address)
    post({ pick: { ...C.anchorAt(el, root(), e.clientX, e.clientY, L), info: C.infoOf(el), ...(window.__dhParent ? { url: location.href } : {}), x: e.clientX, y: e.clientY } });
  }, true);
  document.addEventListener("keydown", (e) => {
    // only Esc: the page's own keys stay the page's (a "c" here must not turn on picking and swallow its clicks)
    if (e.key === "Escape" && on) post({ esc: true });
  }, true);
  addEventListener("scroll", later, true);
  addEventListener("resize", later);
  if (window.ResizeObserver) new ResizeObserver(later).observe(document.documentElement);
  post({ ready: true });
})();
