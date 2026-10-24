// Comments on canvas tabs — what both sides share: the shell (comments.js) and a sandboxed page (comments-frame.js,
// which gets this file inlined). An anchor is the path of element-child indexes from the root to the element, the
// element's own text (to find it again when something above it changed) and the point on it as fractions (fx, fy).
(() => {
  const skip = (el) => el.hasAttribute("data-cmt-ui") || /^(SCRIPT|STYLE|TEMPLATE|LINK|META)$/.test(el.tagName);
  const kids = (el) => [...el.children].filter((c) => !skip(c));
  const textOf = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();
  const STOP = /^(a|button|img|input|select|textarea|svg|canvas|video|iframe|label|picture)$/;
  const tag = (el) => el.tagName.toLowerCase();

  /** The element a click means: not an inline piece of a line (a bold word) and not one path of a drawing. */
  function pickable(el, root) {
    if (!el || !root.contains(el) || el.closest("[data-cmt-ui]")) return null;
    while (el !== root && el.parentElement instanceof SVGElement) el = el.parentElement;
    const hit = el.closest("a,button,label");
    if (hit && hit !== root && root.contains(hit)) return hit;
    while (el !== root && el.parentElement && el.parentElement !== root && !STOP.test(tag(el)) && getComputedStyle(el).display === "inline") el = el.parentElement;
    return el;
  }
  function pathOf(el, root) {
    const out = [];
    for (let x = el; x && x !== root; x = x.parentElement) { const p = x.parentElement; if (!p) return ""; out.unshift(kids(p).indexOf(x)); }
    return out.join(".");
  }
  /** The element of an anchor: at its path if its text still matches, else the deepest one with that text, else the
   *  deepest element that still exists on the path. */
  function find(root, a) {
    let el = root, ok = true;
    for (const i of String(a.path || "").split(".").filter(Boolean).map(Number)) { const k = kids(el)[i]; if (!k) { ok = false; break; } el = k; }
    const want = a.text || "";
    if (ok && (!want || textOf(el).startsWith(want.slice(0, 60)))) return el;
    if (want) {
      const all = [...root.querySelectorAll("*")].filter((x) => !skip(x) && !x.closest("[data-cmt-ui]") && textOf(x) === want);
      const deepest = all.filter((x) => !all.some((y) => y !== x && x.contains(y)));
      if (deepest.length) return deepest[0];
    }
    return el;
  }
  const KIND = { h1: "heading", h2: "heading", h3: "heading", h4: "heading", h5: "heading", h6: "heading", td: "cell", th: "cell", tr: "row", table: "table", li: "item", ul: "list", ol: "list",
    a: "link", button: "button", img: "image", svg: "image", canvas: "image", picture: "image", video: "image", iframe: "block", pre: "code", code: "code", input: "field", textarea: "field", select: "field", label: "field" };
  const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
  /** "Section › kind «text»": the nearest heading before the element (a table cell: its column), what it is, its text. */
  function labelOf(el, root, L) {
    const t = tag(el), kind = KIND[t] || (el.children.length && kids(el).some((c) => getComputedStyle(c).display !== "inline") ? "block" : "text");
    let ctx = "";
    if (t === "td" || t === "th") {
      const tb = el.closest("table"), row = el.parentElement, col = [...row.children].indexOf(el);
      const head = tb?.querySelector("thead tr") || tb?.querySelector("tr");
      if (head && head !== row && head.children[col]) ctx = textOf(head.children[col]);
    }
    if (!ctx) {
      // a heading's context is the heading above it in rank
      const lvl = /^h[1-6]$/.test(t) ? Number(t[1]) : 7;
      const hs = [...root.querySelectorAll("h1,h2,h3,h4")].filter((h) => Number(h.tagName[1]) < lvl && h !== el && !h.contains(el) && (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
      if (hs.length) ctx = textOf(hs[hs.length - 1]);
    }
    const txt = textOf(el) || el.getAttribute("alt") || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "";
    const q = (L.q || "“{s}”").replace("{s}", cut(txt, 48));
    return `${ctx ? `${cut(ctx, 40)} › ` : ""}${L[`k.${kind}`] || kind}${txt ? ` ${q}` : ""}`;
  }
  /** Everything a new comment needs from a click on an element. */
  function anchorAt(el, root, x, y, L) {
    const r = el.getBoundingClientRect(), f = (v) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
    return { path: pathOf(el, root), text: textOf(el).slice(0, 300), fx: f(r.width ? (x - r.left) / r.width : 0.5), fy: f(r.height ? (y - r.top) / r.height : 0.5), label: labelOf(el, root, L) };
  }
  /** Where an anchor's point is now, in the viewport of its document. */
  function pointOf(root, a) {
    const el = find(root, a), r = el.getBoundingClientRect();
    return { x: r.left + a.fx * r.width, y: r.top + a.fy * r.height, el };
  }
  /** What an element is, for the agent: tag, size, the styles that matter, the start of its HTML. */
  function infoOf(el) {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el), t = tag(el);
    const font = `${cs.fontSize} ${cs.fontWeight} ${cs.fontFamily.split(",")[0].replace(/["']/g, "")}`;
    const box = [cs.padding !== "0px" ? `padding ${cs.padding}` : "", cs.borderRadius !== "0px" ? `radius ${cs.borderRadius}` : ""].filter(Boolean).join(" · ");
    const bg = cs.backgroundColor !== "rgba(0, 0, 0, 0)" ? ` · background ${cs.backgroundColor}` : "";
    const html = el.outerHTML.replace(/\s+/g, " ");
    return `<${t}${el.id ? `#${el.id}` : ""}${el.classList.length ? `.${[...el.classList].slice(0, 4).join(".")}` : ""}> ${Math.round(r.width)}×${Math.round(r.height)}px · font ${font} · color ${cs.color}${bg}${box ? ` · ${box}` : ""}\nHTML: ${html.slice(0, 600)}${html.length > 600 ? "…" : ""}`;
  }
  window.dhCmt = { pickable, pathOf, find, labelOf, anchorAt, pointOf, textOf, infoOf };
})();
