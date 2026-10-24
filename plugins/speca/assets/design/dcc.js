// The comparison of two versions of a design canvas (board.canvas.ts compare): the filter by kind and the mode (side by
// side / swipe), each artboard at its column's width, the two sides scrolling together, the swipe's handle.
(() => {
  for (const root of document.querySelectorAll(".dcc:not([data-on])")) {
    root.dataset.on = "1";
    const fit = () => root.querySelectorAll(".dcc-frame").forEach((f) => {
      const i = f.querySelector("iframe");
      if (!i || !f.clientWidth) return;
      const k = f.clientWidth / Number(i.getAttribute("width"));
      f.querySelectorAll("iframe").forEach((x) => { x.style.transform = `scale(${k})`; });
      f.style.height = `${Number(i.getAttribute("height")) * k}px`;
    });
    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-dcc-set]");
      if (!b) return;
      const [key, v] = b.dataset.dccSet.split(":");
      root.dataset[key] = v;
      b.parentElement.querySelectorAll("[data-dcc-set]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      requestAnimationFrame(fit);
    });
    // the two sides of a pair scroll together (a tall page compared at one place)
    root.querySelectorAll(".dcc-pair").forEach((p) => {
      const [a, b] = p.querySelectorAll(".dcc-scroll");
      if (!a || !b) return;
      let lock = false;
      const follow = (from, to) => () => { if (lock) return; lock = true; to.scrollTop = from.scrollTop; requestAnimationFrame(() => { lock = false; }); };
      a.addEventListener("scroll", follow(a, b)); b.addEventListener("scroll", follow(b, a));
    });
    root.addEventListener("input", (e) => {
      const r = e.target.closest(".dcc-swipe input[type=range]");
      if (r) r.closest(".dcc-swipe").style.setProperty("--x", `${r.value}%`);
    });
    new ResizeObserver(fit).observe(root);
    fit();
  }
})();
