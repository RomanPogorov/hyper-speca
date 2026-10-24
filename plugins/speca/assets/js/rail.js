// The message rail of a chat (like T3 Code's): a column of short ticks at the left edge of the log, one per message of
// a person — longer when the answer after it was big. Hover shows the message's start, time and context; a click
// scrolls there and highlights it; the ticks of what is on screen are marked. From 4 messages on; not in narrow
// chats. Every .log on the page gets its own (subagent drawers too).
(() => {
  const RAILS = new WeakMap();
  const MIN = 4;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function attach(log) {
    if (RAILS.has(log)) return RAILS.get(log).build();
    const host = log.parentElement;
    if (!host) return;
    const rail = document.createElement("nav");
    rail.className = "msg-rail"; rail.setAttribute("aria-label", document.documentElement.lang === "ru" ? "Сообщения" : "Messages");
    rail.hidden = true;
    const pop = document.createElement("div");
    pop.className = "mr-pop"; pop.hidden = true;
    host.append(rail, pop);
    let items = [];

    function build() {
      const us = [...log.querySelectorAll(".log-inner .e.u")];
      const narrow = log.clientWidth < 300;
      if (us.length < MIN || narrow) { rail.hidden = true; pop.hidden = true; items = []; log.classList.remove("has-rail"); return; }
      log.classList.add("has-rail");
      // positions in the log's own scroll space; the answer's size: from this message to the next one
      const lr = log.getBoundingClientRect();
      const at = (el) => el.getBoundingClientRect().top - lr.top + log.scrollTop;
      const end = log.scrollHeight;
      items = us.map((el, i) => {
        const top = at(el), bottom = us[i + 1] ? at(us[i + 1]) : end;
        return { el, top, size: Math.max(0, bottom - top - el.offsetHeight) };
      });
      // a short answer a short tick, a long one up to 24px (log scale: 60px of answer → 8, ~2000px → 24)
      const w = (size) => Math.round(Math.max(8, Math.min(24, 8 + 3.2 * Math.log2(Math.max(1, size / 60)))));
      rail.innerHTML = items.map((x, i) => `<button type="button" class="mr-t" data-i="${i}" style="--w:${w(x.size)}px" aria-label="${esc(text(x.el).slice(0, 60))}"></button>`).join("");
      rail.hidden = false;
      place(); mark();
    }
    // centred along the log, squeezed when there are many
    function place() {
      const n = items.length; if (!n) return;
      const avail = log.clientHeight - 24;
      const gap = Math.max(2, Math.min(8, Math.floor(avail / n) - 2));
      rail.style.setProperty("--gap", `${gap}px`);
      const h = rail.offsetHeight;
      rail.style.top = `${log.offsetTop + Math.max(12, (log.clientHeight - h) / 2)}px`;
    }
    function mark() {
      const a = log.scrollTop, b = a + log.clientHeight;
      rail.querySelectorAll(".mr-t").forEach((t, i) => {
        const it = items[i], end = items[i + 1] ? items[i + 1].top : Infinity;
        t.classList.toggle("in", it.top < b && end > a);
      });
    }
    const text = (el) => (el.querySelector(".bubble")?.textContent ?? el.querySelector(".u-file")?.textContent ?? "").replace(/\s+/g, " ").trim();
    rail.addEventListener("mouseover", (e) => {
      const t = e.target.closest(".mr-t"); if (!t) return;
      const it = items[Number(t.dataset.i)]; if (!it) return;
      const when = it.el.querySelector(".when")?.textContent?.trim() ?? "";
      const ctx = [...it.el.querySelectorAll(".u-ctx .cchip")].map((c) => `<span class="cchip">${c.innerHTML}</span>`).join("");
      const s = text(it.el);
      pop.innerHTML = `<div class="mr-text">${esc(s.length > 160 ? `${s.slice(0, 160)}…` : s || "—")}</div>${ctx ? `<div class="mr-ctx">${ctx}</div>` : ""}<div class="mr-when">${esc(when)}</div>`;
      pop.hidden = false;
      const r = t.getBoundingClientRect(), hr = host.getBoundingClientRect();
      pop.style.top = `${Math.max(8, Math.min(r.top - hr.top - 14, host.clientHeight - pop.offsetHeight - 8))}px`;
    });
    rail.addEventListener("mouseleave", () => { pop.hidden = true; });
    rail.addEventListener("click", (e) => {
      const t = e.target.closest(".mr-t"); if (!t) return;
      const it = items[Number(t.dataset.i)]; if (!it) return;
      log.scrollTo({ top: Math.max(0, it.top - 16), behavior: "smooth" });
      it.el.classList.remove("found"); void it.el.offsetWidth; it.el.classList.add("found");
      setTimeout(() => it.el.classList.remove("found"), 2500);
    });
    let raf = 0;
    log.addEventListener("scroll", () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(mark); }, { passive: true });
    const ro = new ResizeObserver(() => build());
    ro.observe(log);
    let t = 0;
    new MutationObserver(() => { clearTimeout(t); t = setTimeout(build, 150); }).observe(log, { childList: true, subtree: true });
    RAILS.set(log, { build });
    build();
  }

  const scan = () => document.querySelectorAll(".log").forEach((l) => { if (l.querySelector(".log-inner")) attach(l); });
  document.addEventListener("htmx:afterSettle", scan);
  document.addEventListener("DOMContentLoaded", scan);
  scan();
})();
