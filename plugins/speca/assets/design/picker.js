// Runs inside each artboard (a sandboxed iframe, 1:1). It draws nothing itself: it finds the element under the pointer
// by the Figma rules and tells the host its address, rectangle and styles; the host draws rings, the panel and menus.
// Every element carries the tid of its tag in the source (data-tid): the copies a repeat made share it, so the
// selection is a set of tids and everything with one of them is selected. In preview (?play=1) it only turns links
// to other artboards into navigation.
(() => {
  const send = (m) => parent.postMessage({ __dcv: m }, "*");
  const SKIP = new Set(["SCRIPT", "STYLE", "LINK", "META", "TITLE", "HEAD", "NOSCRIPT", "TEMPLATE"]);
  const DIRECTIVE = new Set(["DC-FOR", "DC-IF"]);   // older frames; a repeat is a pair of comment markers now
  // the markers a repeat or a branch leaves: <!--dc:for TID N--> … <!--/dc:for TID-->, <!--dc:if TID on--> …
  const MARK = /^(\/?)dc:(for|if) (\d+)(?: (\S+))?$/;
  const markOf = (node) => node.nodeType === 8 ? MARK.exec(node.data.trim()) : null;
  // the source children of a container: an element, or a repeat / branch with the elements it rendered
  const entries = (par) => {
    const out = []; let cur = null, depth = 0;
    for (const c of par.childNodes) {
      const m = markOf(c);
      if (m && !m[1]) { if (!depth++) { cur = { tid: Number(m[3]), kind: m[2], n: m[4], els: [] }; out.push(cur); } continue; }
      if (m && m[1]) { if (!--depth) cur = null; continue; }
      if (c.nodeType !== 1 || !c.dataset.tid) continue;
      if (cur) cur.els.push(c); else out.push({ tid: tidOf(c), els: [c] });
    }
    return out;
  };
  const markerFirst = (tid) => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT);
    for (let c; (c = w.nextNode()); ) { const m = markOf(c); if (m && !m[1] && Number(m[3]) === tid) { for (let x = c.nextSibling; x; x = x.nextSibling) { if (markOf(x)?.[1] && Number(markOf(x)[3]) === tid) return null; if (x.nodeType === 1 && x.dataset.tid) return x; } } }
    return null;
  };

  if (new URLSearchParams(location.search).has("play")) {
    document.addEventListener("click", (e) => {
      const a = e.target.closest?.("a[href]"); if (!a) return;
      e.preventDefault();
      const m = /^(?:\.\/)?([A-Za-z0-9_][A-Za-z0-9_.-]*\.html)(?:#.*)?$/.exec(a.getAttribute("href") || "");
      if (m) send({ t: "nav", file: m[1] });
    }, true);
    document.addEventListener("keydown", (e) => send({ t: "key", key: e.key, meta: e.metaKey || e.ctrlKey, shift: e.shiftKey, alt: e.altKey }), true);
    send({ t: "ready", h: document.documentElement.scrollHeight, play: true });
    return;
  }

  // the canvas moves and zooms over artboards too: the wheel belongs to the host
  addEventListener("wheel", (e) => { e.preventDefault(); send({ t: "wheel", dx: e.deltaX, dy: e.deltaY, x: e.clientX, y: e.clientY, zoom: e.ctrlKey || e.metaKey }); }, { passive: false });
  // and the fingers: one pans, two pinch — in screen coordinates, since the frame itself moves under them
  let fp = null;
  const fingers = (e) => {
    const t = [...e.touches], n = t.length, avg = (k) => t.reduce((a, p) => a + p[k], 0) / n;
    return { n, x: avg("screenX"), y: avg("screenY"), cx: avg("clientX"), cy: avg("clientY"), d: n > 1 ? Math.hypot(t[0].screenX - t[1].screenX, t[0].screenY - t[1].screenY) : 0 };
  };
  addEventListener("touchstart", (e) => { fp = fingers(e); }, { passive: true });
  addEventListener("touchmove", (e) => {
    if (!fp || editing) return;
    e.preventDefault();
    const f = fingers(e);
    if (f.n === fp.n) send({ t: "touch", dx: f.x - fp.x, dy: f.y - fp.y, f: f.n > 1 && fp.d ? f.d / fp.d : 1, x: f.cx, y: f.cy });
    fp = f;
  }, { passive: false });
  addEventListener("touchend", (e) => { fp = e.touches.length ? fingers(e) : null; }, { passive: true });
  const all = (tid) => [...document.querySelectorAll(`[data-tid="${tid}"]`)];
  const first = (tid) => document.querySelector(`[data-tid="${tid}"]`);
  const tidOf = (n) => Number(n.dataset.tid);
  const root = () => [...document.body.children].find((n) => n.dataset.tid && !SKIP.has(n.tagName));
  let sel = null, extra = [], hov = null, editing = null, mode = "";
  // the levels a click can land on, outermost first; a file written as a whole document lends its tids to the
  // frame's own html and body — those are never a level
  const DOC = new Set(["HTML", "HEAD", "BODY"]);
  const chainOf = (el) => { const c = []; for (let n = el?.closest?.("[data-tid]"); n; n = n.parentElement?.closest("[data-tid]")) if (!DIRECTIVE.has(n.tagName) && !DOC.has(n.tagName)) c.unshift(n); return c; };
  // the full-size wrapper of the board is not a selectable level
  const wrapper = (n) => n === root() && n.getBoundingClientRect().width >= innerWidth - 2;
  const levels = (el) => chainOf(el).filter((n) => !wrapper(n));
  const pathOf = (n) => { const p = []; for (let c = n; c && c !== document.body; c = c.parentElement) { const par = c.parentElement; if (!par) break; p.unshift([...par.children].indexOf(c)); } return p.join("/"); };
  const words = (n) => (n.innerText || n.getAttribute("aria-label") || n.getAttribute("alt") || "").replace(/\s+/g, " ").trim().slice(0, 40);
  const rectOf = (n) => { const r = n.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; };
  const isText = (n) => n && !n.dataset?.import && ![...n.children].some((c) => getComputedStyle(c).display !== "inline" && c.tagName !== "BR") && (n.innerText || "").trim().length > 0;
  const visible = (n) => n.checkVisibility ? n.checkVisibility() : n.getClientRects().length > 0;

  // what kind of thing an element is, for layer names: layout first (Row / Column / Grid), then the tag
  const kindOf = (n) => {
    if (n.tagName === "DC-FOR") return "repeat";
    if (n.tagName === "DC-IF") return "cond";
    if (n.dataset.import) return "component";
    const tag = n.tagName.toLowerCase(), cs = getComputedStyle(n);
    if (/^h[1-6]$/.test(tag)) return "heading";
    const k = { p: "paragraph", button: "button", a: "link", img: "image", picture: "image", input: "input", textarea: "input", select: "input", ul: "list", ol: "list", li: "item", svg: "icon", nav: "nav", header: "header", footer: "footer", section: "section", form: "form", label: "label", hr: "divider", table: "table" }[tag];
    if (k) return k;
    if (cs.display.includes("grid")) return "grid";
    if (cs.display.includes("flex")) return cs.flexDirection.startsWith("column") ? "column" : "row";
    return isText(n) ? "text" : "box";
  };
  // hand-written copies around an element (not a repeat yet): the nearest level whose siblings share its tag, class
  // and style; the host offers to make them one repeat
  // what makes elements alike: tag, classes and the style's declarations (in any order, any spacing)
  const sigOf = (n) => `${n.tagName}|${(n.getAttribute("class") || "").trim().split(/\s+/).sort().join(" ")}|${Object.entries(authored(n)).map(([k, v]) => `${k}:${v.replace(/\s+/g, " ")}`).sort().join(";")}`;
  const twinsOf = (n) => {
    if (n.closest("[data-item], [data-import]")) return null;
    const sub = [];
    for (let a = n; a && !wrapper(a) && a.parentElement; ) {
      const up = a.parentElement.closest("[data-tid]:not(dc-for):not(dc-if)");
      if (!DIRECTIVE.has(a.parentElement.tagName)) {
        const s = sigOf(a), sibs = [...a.parentElement.children].filter((c) => c.dataset.tid && !SKIP.has(c.tagName)), i = sibs.indexOf(a);
        let lo = i, hi = i;
        while (lo > 0 && sigOf(sibs[lo - 1]) === s) lo--;
        while (hi < sibs.length - 1 && sigOf(sibs[hi + 1]) === s) hi++;
        if (hi > lo) return { tid: tidOf(a), count: hi - lo + 1, index: i - lo, sub };
      }
      if (!up) break;
      sub.unshift(kidsOf(up).indexOf(a)); a = up;
    }
    return null;
  };
  // the values of the data item a copy came from (its own fields, not nested lists) — the panel's "Row data"
  const itemData = (n) => {
    const host = n.closest("[data-item]"); if (!host) return null;
    let data; try { data = JSON.parse(document.querySelector("script[data-dc-data]")?.textContent || "{}"); } catch { return null; }
    let v = data; for (const k of host.dataset.item.split(".")) v = v?.[k];
    if (!v || typeof v !== "object") return null;
    const fields = Object.fromEntries(Object.entries(v).filter(([, x]) => x === null || ["string", "number", "boolean"].includes(typeof x)));
    return Object.keys(fields).length ? { path: host.dataset.item, fields } : null;
  };
  const info = (n) => ({
    tid: tidOf(n), path: pathOf(n), rect: rectOf(n), tag: n.tagName.toLowerCase(), text: words(n), textual: isText(n), kind: kindOf(n), root: wrapper(n),
    group: kidsOf(n).length > 0 && !isText(n) && !n.dataset.import && !/^DC-/.test(n.tagName),
    copies: all(tidOf(n)).length, item: n.dataset.item || null, within: n.closest("[data-item]")?.dataset.item || null, data: itemData(n), inRepeat: !!n.closest("[data-item]"), import: n.dataset.import || null,
    abs: /absolute|fixed/.test(getComputedStyle(n).position), twins: twinsOf(n), href: n.getAttribute("href"), src: n.tagName === "IMG" ? (n.getAttribute("src") || "").slice(0, 80) : null,
  });

  // ── the probe: authored (inline) and rendered styles, the parent's layout, the ground under text ──
  const PROPS = ["width", "height", "min-width", "max-width", "min-height", "max-height", "flex-grow", "grid-column", "display", "flex-direction", "flex-wrap", "justify-content", "align-items",
    "gap", "row-gap", "column-gap", "grid-template-columns", "padding-top", "padding-right", "padding-bottom", "padding-left", "margin-top", "margin-right", "margin-bottom", "margin-left",
    "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "color", "text-align", "text-transform", "background-color", "background-image", "background-size", "opacity",
    "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius", "border-top-width", "border-top-style", "border-top-color", "box-shadow", "overflow", "z-index", "position", "left", "top"];
  const authored = (n) => {
    const out = {}; let buf = "", depth = 0, q = "";
    const flush = () => { const k = buf.indexOf(":"); if (k > 0) { const p = buf.slice(0, k).trim(), v = buf.slice(k + 1).trim(); if (p && v) out[p.startsWith("--") ? p : p.toLowerCase()] = v; } buf = ""; };
    for (const c of n.getAttribute("style") || "") {
      if (q) { buf += c; if (c === q) q = ""; continue; }
      if (c === '"' || c === "'") q = c;
      if (c === "(") depth++; if (c === ")") depth = Math.max(0, depth - 1);
      if (c === ";" && !depth) { flush(); continue; }
      buf += c;
    }
    flush(); return out;
  };
  const rgba = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ""); if (!m) return null; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  // the colour actually behind the element: semi-transparent backgrounds stacked up to the first opaque one; unknown
  // when an image, a gradient, a filter or opacity is in the way
  const ground = (n) => {
    const layers = [];
    for (let e = n; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage !== "none" || cs.filter !== "none" || (e !== n && Number(cs.opacity) < 1)) return null;
      const c = rgba(cs.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let out = { r: 255, g: 255, b: 255 };
    for (const c of layers.reverse()) out = { r: c.r * c.a + out.r * (1 - c.a), g: c.g * c.a + out.g * (1 - c.a), b: c.b * c.a + out.b * (1 - c.a) };
    return out;
  };
  // across a multi-selection: the properties set differently (shown as "Mixed")
  const mixedOf = (els) => {
    if (els.length < 2) return [];
    const maps = els.map(authored), keys = new Set(maps.flatMap((m) => Object.keys(m)));
    return [...keys].filter((k) => maps.some((m) => m[k] !== maps[0][k]));
  };
  const probe = (n, others = []) => {
    const cs = getComputedStyle(n), computed = {};
    for (const p of PROPS) computed[p] = cs.getPropertyValue(p);
    const pcs = n.parentElement ? getComputedStyle(n.parentElement.closest(":not(dc-for):not(dc-if)") || n.parentElement) : null;
    return { authored: authored(n), computed, parent: pcs ? { display: pcs.display, direction: pcs.flexDirection } : null, ground: isText(n) && !others.length ? ground(n) : null,
      size: { w: Math.round(n.getBoundingClientRect().width), h: Math.round(n.getBoundingClientRect().height) }, mixed: mixedOf([n, ...others]) };
  };

  // ── what the artboard is made of: the layers, its colours, its type scale, its tokens ──
  const tree = () => {
    const out = [];
    const row = (c, depth) => { const w = wrapper(c); if (!w) out.push({ tid: tidOf(c), depth, kind: kindOf(c), text: words(c).slice(0, 28), kids: !c.dataset.import && [...c.children].some((x) => x.dataset.tid && !SKIP.has(x.tagName)) }); if (out.length < 600 && !c.dataset.import) walk(c, w ? depth : depth + 1); };
    const walk = (n, depth) => {
      for (const e of entries(n)) {
        if (!e.kind) { if (!SKIP.has(e.els[0].tagName)) row(e.els[0], depth); continue; }
        // a repeat shows as one row and its template once (the first copy); a branch that is off shows nothing
        if (e.kind === "for") { out.push({ tid: e.tid, depth, kind: "repeat", text: e.n || String(e.els.length), kids: e.els.length > 0 }); const seen = new Set(); for (const c of e.els) if (!seen.has(c.dataset.tid)) { seen.add(c.dataset.tid); row(c, depth + 1); } }
        else for (const c of e.els) row(c, depth);
      }
    };
    walk(document.body, 0);
    return out;
  };
  const hex = (c) => "#" + [c.r, c.g, c.b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("") + (c.a < 1 ? Math.round(c.a * 255).toString(16).padStart(2, "0") : "");
  const palette = () => {
    const count = new Map();
    for (const n of document.querySelectorAll("[data-tid]")) {
      if (SKIP.has(n.tagName)) continue;
      const cs = getComputedStyle(n);
      for (const v of [cs.color, cs.backgroundColor, Number.parseFloat(cs.borderTopWidth) ? cs.borderTopColor : ""]) { const c = rgba(v); if (c && c.a > 0) { const h = hex(c); count.set(h, (count.get(h) || 0) + 1); } }
    }
    return [...count].sort((a, b) => b[1] - a[1]).slice(0, 16).map(([h]) => h);
  };
  // custom properties the artboard declares (inline on any element, or in its <style>) that hold a colour
  const tokens = () => {
    const found = new Map(), probeEl = document.createElement("i");
    probeEl.style.display = "none";
    const add = (name, holder) => {
      if (found.has(name) || !holder) return;
      const raw = getComputedStyle(holder).getPropertyValue(name).trim(); if (!raw) return;
      holder.append(probeEl); probeEl.style.color = ""; probeEl.style.color = `var(${name})`;
      const c = CSS.supports("color", raw) ? rgba(getComputedStyle(probeEl).color) : null;
      probeEl.remove();
      if (c) found.set(name, { name, value: raw, hex: hex(c) });
    };
    for (const n of document.querySelectorAll("[style*='--']")) for (const k of Object.keys(authored(n))) if (k.startsWith("--")) add(k, n);
    for (const sh of document.styleSheets) { try { for (const r of sh.cssRules) for (const p of r.style || []) if (p.startsWith("--")) add(p, document.querySelector(r.selectorText) || document.documentElement); } catch { /* */ } }
    return [...found.values()].slice(0, 40);
  };
  // the type scale, inferred from the artboard: the most used body size is Body, larger ones are headings by size,
  // smaller ones caption and small; each role takes the weight, line height and tracking most used at its size
  const scale = () => {
    const by = new Map(), bodyVotes = new Map(), buttonVotes = new Map();
    for (const n of document.querySelectorAll("[data-tid]")) {
      if (SKIP.has(n.tagName) || DIRECTIVE.has(n.tagName) || !isText(n)) continue;
      const cs = getComputedStyle(n), fs = Math.round(Number.parseFloat(cs.fontSize) * 2) / 2;
      const lh = cs.lineHeight === "normal" ? "" : String(Math.round((Number.parseFloat(cs.lineHeight) / Number.parseFloat(cs.fontSize)) * 100) / 100);
      const key = `${cs.fontWeight}|${lh}|${cs.letterSpacing === "normal" ? "" : cs.letterSpacing}`;
      const m = by.get(fs) || new Map(); m.set(key, (m.get(key) || 0) + 1); by.set(fs, m);
      if (/^(P|LI|TD|DD|SPAN|DIV|LABEL)$/.test(n.tagName)) bodyVotes.set(fs, (bodyVotes.get(fs) || 0) + (n.tagName === "P" || n.tagName === "LI" ? 2 : 1));
      if (n.tagName === "BUTTON" || n.closest("button")) buttonVotes.set(fs, (buttonVotes.get(fs) || 0) + 1);
    }
    if (!by.size) return [];
    const sizes = [...by.keys()].sort((a, b) => b - a);
    const votes = bodyVotes.size ? bodyVotes : new Map(sizes.map((s) => [s, [...by.get(s).values()].reduce((x, y) => x + y, 0)]));
    const body = [...votes].sort((a, b) => b[1] - a[1])[0][0];
    const top = (fs) => { const [w, lh, ls] = [...by.get(fs)].sort((a, b) => b[1] - a[1])[0][0].split("|"); return { size: `${fs}px`, weight: w, lh, ls }; };
    const out = [];
    let h = 0;
    const total = (fs) => [...by.get(fs).values()].reduce((x, y) => x + y, 0);
    // a size only buttons use is the button style, not a heading
    for (const fs of sizes.filter((s) => s > body && (buttonVotes.get(s) || 0) < total(s))) { if (++h > 6) break; out.push({ role: "h", n: h, ...top(fs) }); }
    out.push({ role: "body", ...top(body) });
    sizes.filter((s) => s < body).slice(0, 2).forEach((fs, i) => out.push({ role: i === 0 ? "caption" : "small", ...top(fs) }));
    const btn = [...buttonVotes].sort((a, b) => b[1] - a[1])[0];
    if (btn) { const bw = [...by.get(btn[0])].map(([k]) => k.split("|")).find(([w]) => Number(w) >= 500); out.push({ role: "button", ...top(btn[0]), ...(bw ? { weight: bw[0] } : {}) }); }
    return out;
  };
  const facts = () => ({ tree: tree(), palette: palette(), tokens: tokens(), scale: scale(), colors: colorsIn([document.body]) });
  const ready = () => send({ t: "ready", h: document.documentElement.scrollHeight, ...facts() });

  // ── picking ──
  const pick = (target, how) => {
    const lv = levels(target);
    if (!lv.length) return chainOf(target)[0] || null;   // the artboard's root itself
    if (how === "deep") return lv[lv.length - 1];
    const at = sel ? lv.indexOf(sel) : -1;
    if (how === "deeper") return at >= 0 && at < lv.length - 1 ? lv[at + 1] : lv[lv.length - 1];
    // a click inside what is selected goes one level deeper (as in Claude Design); elsewhere it keeps the level
    if (at >= 0) return lv[Math.min(at + 1, lv.length - 1)];
    // keep the depth of the current selection (siblings), else the top level
    const depth = sel ? Math.max(0, levels(sel).length - 1) : 0;
    return lv[Math.min(depth, lv.length - 1)];
  };
  const parentOf = (n) => { const c = chainOf(n); return c[c.length - 2] ?? n; };
  // The same elements of the artboard: one tag and one style (class and inline style) — what a design draws alike,
  // wherever on the artboard it stands — plus every copy of its tag in a repeat. A style edit goes to all of them, so
  // they stay alike; "only this" (solo) edits one, which then is a kind of its own. Text and structure are per element.
  let solo = false;
  const sameOf = (n) => {
    const out = new Set(all(tidOf(n)));
    if (solo || wrapper(n) || (!n.getAttribute("class") && !n.getAttribute("style"))) return [...out];
    const k = sigOf(n);
    for (const x of document.querySelectorAll(`${n.tagName}[data-tid]`)) if (!wrapper(x) && sigOf(x) === k) out.add(x);
    return [...out];
  };
  const picked = () => (sel ? [sel, ...extra] : []);
  const report = (quiet) => {
    if (!sel) return send({ t: "clear" });
    const same = [...new Set(picked().flatMap(sameOf))], others = same.filter((n) => n !== sel && visible(n));
    const wasSolo = solo; solo = false; const linkable = new Set(picked().flatMap(sameOf)).size; solo = wasSolo;
    send({ t: "select", ...info(sel), tids: [...new Set(same.map(tidOf))], own: [...new Set(picked().map(tidOf))], same: same.length, linkable, solo, rings: others.map(rectOf),
      probe: probe(sel, extra), colors: colorsIn(same), multi: extra.length > 0, quiet: !!quiet });
  };
  // the colours used inside the selection (or the whole artboard): each with the elements and properties that paint
  // it; an inherited text colour counts once, where it is set
  const COLOR_PROPS = [["color", "color"], ["background-color", "backgroundColor"], ["border-color", "borderTopColor"], ["fill", "fill"], ["stroke", "stroke"]];
  const colorsIn = (roots) => {
    const map = new Map();
    const els = new Set();
    for (const r of roots) { els.add(r); r.querySelectorAll("[data-tid]").forEach((x) => els.add(x)); }
    for (const n of els) {
      if (SKIP.has(n.tagName)) continue;
      const cs = getComputedStyle(n), pcs = n.parentElement ? getComputedStyle(n.parentElement) : null;
      for (const [prop, key] of COLOR_PROPS) {
        if (prop === "border-color" && !(Number.parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none")) continue;
        if ((prop === "fill" || prop === "stroke") && !(n instanceof SVGElement)) continue;
        if ((prop === "color" || prop === "fill" || prop === "stroke") && pcs && pcs[key] === cs[key] && !authored(n)[prop]) continue;   // inherited
        if (prop === "color" && !isText(n) && ![...n.children].length) continue;
        const c = rgba(cs[key]); if (!c || c.a === 0) continue;
        const h = hex(c), e = map.get(h) || { hex: h, n: 0, uses: [] };
        e.n++; if (!e.uses.some((u) => u.tid === tidOf(n) && u.prop === prop)) e.uses.push({ tid: tidOf(n), prop });
        map.set(h, e);
      }
    }
    return [...map.values()].sort((a, b) => b.n - a.n).slice(0, 24);
  };
  const select = (n, add) => {
    if (add && sel && n) {
      if (n === sel) sel = extra.shift() || null;
      else if (extra.includes(n)) extra = extra.filter((x) => x !== n);
      else extra.push(n);
    } else { sel = n; extra = []; solo = false; }
    report();
  };
  const hoverOf = (n) => n ? { t: "hover", ...info(n), rings: (n === sel ? [] : sameOfFree(n)).filter((x) => x !== n && visible(x)).map(rectOf) } : { t: "hover-off" };
  const sameOfFree = (n) => { const s = solo; solo = false; const r = sameOf(n); solo = s; return r; };

  // ── pointer: click selects (shift adds), drag moves the selection or draws a marquee ──
  let down = null, swallow = false, ptAt = 0;
  document.addEventListener("pointerdown", (e) => {
    if (editing || e.button !== 0 || e.pointerType === "touch") return;   // a finger moves the canvas (below); a tap selects
    // a drag that starts on what is selected moves it (a click there, without moving, goes deeper)
    const n = mode === "comment" ? null : sel && sel.contains(e.target) && !(e.metaKey || e.ctrlKey) ? sel : pick(e.target, e.metaKey || e.ctrlKey ? "deep" : "click");
    down = { x: e.clientX, y: e.clientY, n, shift: e.shiftKey, active: null };
  }, true);
  document.addEventListener("pointermove", (e) => {
    if (editing) return;
    if (down) {
      if (!down.active && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 && mode !== "comment") {
        const n = down.n;
        if (!n || wrapper(n)) down.active = "marq";
        else if (n.dataset.item) down.active = "none";   // a copy of a repeat moves with its data (menu: up / down)
        else { if (sel !== n && !extra.includes(n)) select(n); down.active = /absolute|fixed/.test(getComputedStyle(n).position) ? "abs" : "flow"; down.left = n.offsetLeft; down.top = n.offsetTop; }
      }
      if (down.active === "marq") return send({ t: "marq", rect: box(down.x, down.y, e.clientX, e.clientY) });
      if (down.active === "flow") return send({ t: "drop", rect: dropAt(sel, e.clientX, e.clientY)?.line || null });
      if (down.active === "abs") { sel.style.left = `${Math.round(down.left + e.clientX - down.x)}px`; sel.style.top = `${Math.round(down.top + e.clientY - down.y)}px`; return report(true); }
      if (down.active) return;
    }
    // where the pointer is, for the others on this canvas (a few times a second)
    if (Date.now() - ptAt > 120) { ptAt = Date.now(); send({ t: "pt", x: e.clientX + scrollX, y: e.clientY + scrollY }); }
    const n = pick(e.target, e.metaKey || e.ctrlKey || mode === "comment" ? "deep" : "click");
    if (n === hov) return;
    hov = n; send(hoverOf(n));
  }, true);
  document.addEventListener("pointerup", (e) => {
    const d = down; down = null;
    if (!d?.active) return;
    swallow = true;
    if (d.active === "marq") { send({ t: "marq", rect: null }); return marquee(box(d.x, d.y, e.clientX, e.clientY), d.shift); }
    if (d.active === "flow") { send({ t: "drop", rect: null }); const at = dropAt(sel, e.clientX, e.clientY); if (at && at.to !== at.from) send({ t: "reorder", tid: tidOf(sel), to: at.to }); }
    if (d.active === "abs") send({ t: "moved", tid: tidOf(sel), left: sel.style.left, top: sel.style.top });
  }, true);
  const box = (x0, y0, x1, y1) => ({ x: Math.min(x0, x1) + scrollX, y: Math.min(y0, y1) + scrollY, w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) });
  // element children, looking through repeats and branches (their copies are children of the container)
  const kidsOf = (n) => [...n.children].flatMap((c) => DIRECTIVE.has(c.tagName) ? kidsOf(c) : c.dataset.tid && !SKIP.has(c.tagName) ? [c] : []);
  // the children of the deepest container holding the whole marquee that it touches
  const marquee = (r, add) => {
    const hit = (n) => { const b = rectOf(n); return b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y; };
    const holds = (n) => { const b = rectOf(n); return b.x <= r.x && b.y <= r.y && b.x + b.w >= r.x + r.w && b.y + b.h >= r.y + r.h; };
    let host = root() || document.body;
    for (;;) { const inner = kidsOf(host).find(holds); if (!inner || !kidsOf(inner).length) break; host = inner; }
    const got = kidsOf(host).filter(hit);
    if (!got.length) return;
    if (!add || !sel) { sel = got[0]; extra = got.slice(1); } else for (const n of got) if (n !== sel && !extra.includes(n)) extra.push(n);
    report();
  };
  // where the dragged element would go among its siblings: the slot (index in the source order) and a line to draw
  const dropAt = (n, cx, cy) => {
    const par = n?.parentElement; if (!par) return null;
    // every source child of the container (a data block, a whole repeat too): the slot is an index among them
    const sibs = entries(par), from = sibs.findIndex((e) => e.els.includes(n));
    if (from < 0 || sibs[from].kind) return null;
    const box = (e) => { const r = e.els.filter((x) => !SKIP.has(x.tagName) && visible(x)).map(rectOf); if (!r.length) return null; const x0 = Math.min(...r.map((q) => q.x)), y0 = Math.min(...r.map((q) => q.y)); return { x: x0, y: y0, w: Math.max(...r.map((q) => q.x + q.w)) - x0, h: Math.max(...r.map((q) => q.y + q.h)) - y0 }; };
    const others = sibs.filter((_, i) => i !== from), rest = others.map((e) => [e, box(e)]).filter(([, b]) => b);
    const cs = getComputedStyle(par), row = cs.display.includes("flex") && cs.flexDirection.startsWith("row"), grid = cs.display.includes("grid");
    const x = cx + scrollX, y = cy + scrollY;
    let at = rest.length, line = null;
    for (let i = 0; i < rest.length; i++) {
      const b = rest[i][1];
      const before = grid ? y < b.y || (y < b.y + b.h && x < b.x + b.w / 2) : row ? x < b.x + b.w / 2 : y < b.y + b.h / 2;
      if (before) { at = i; line = row || grid ? { x: b.x - 2, y: b.y, w: 2, h: b.h } : { x: b.x, y: b.y - 2, w: b.w, h: 2 }; break; }
    }
    if (!line && rest.length) { const b = rest[rest.length - 1][1]; line = row || grid ? { x: b.x + b.w, y: b.y, w: 2, h: b.h } : { x: b.x, y: b.y + b.h, w: b.w, h: 2 }; }
    return { to: at < rest.length ? others.indexOf(rest[at][0]) : others.length, from, line };
  };

  document.addEventListener("mouseleave", () => { hov = null; send({ t: "hover-off" }); });
  document.addEventListener("click", (e) => {
    if (editing && editing.contains(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    if (swallow) { swallow = false; return; }
    if (editing) finishEdit(true);
    if (mode === "comment") return pin(e);
    select(pick(e.target, e.metaKey || e.ctrlKey ? "deep" : "click"), e.shiftKey);
  }, true);
  document.addEventListener("dblclick", (e) => {
    e.preventDefault();
    if (mode === "comment") return;
    const n = pick(e.target, "deeper");
    if (n && n === sel && n.dataset.import) return send({ t: "open-component", file: n.dataset.import });
    if (n && n === sel && isText(n)) return startEdit(n);
    select(n);
  }, true);
  document.addEventListener("contextmenu", (e) => { e.preventDefault(); const n = pick(e.target, "click"); if (n && n !== sel && !extra.includes(n)) select(n); send({ t: "menu", x: e.clientX, y: e.clientY }); }, true);
  // a comment pin: the element under the pointer (the deepest) and where on it, or the artboard itself
  const pin = (e) => {
    const n = levels(e.target).pop() || null, x = e.clientX + scrollX, y = e.clientY + scrollY;
    if (!n) return send({ t: "pin", tid: -1, path: "", fp: "", fx: x / document.documentElement.scrollWidth, fy: y / document.documentElement.scrollHeight, x, y });
    const r = rectOf(n);
    send({ t: "pin", tid: tidOf(n), path: pathOf(n), fp: words(n), fx: r.w ? (x - r.x) / r.w : 0, fy: r.h ? (y - r.y) / r.h : 0, x, y, kind: kindOf(n), text: words(n), tag: n.tagName.toLowerCase() });
  };
  // a text made of holes is edited as its template: the holes show ({{t.title}}) and the edit changes every copy
  const startEdit = (n) => {
    if (editing === n) return;   // already editing it (a second double click): keep what it showed
    if (editing) finishEdit(true);
    editing = n;
    if (n.dataset.tpl !== undefined) { n.dataset.shown = n.innerText; n.innerText = n.dataset.tpl; }
    // a template's text stays plain (its holes); any other text takes bold, italic, underline in place (⌘B ⌘I ⌘U)
    n.dataset.before = n.innerText; n.dataset.beforeHtml = n.innerHTML; n.dataset.kids = String(n.querySelectorAll("*").length); n.contentEditable = n.dataset.tpl !== undefined ? "plaintext-only" : "true"; n.focus();
    // leaving the text (a click on the canvas, the panel, another app) ends the edit as Enter does
    n.addEventListener("blur", () => { if (editing === n) finishEdit(true); }, { once: true });
    const r = document.createRange(); r.selectNodeContents(n); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    send({ t: "editing", ...info(n) });
  };
  const finishEdit = (keep) => {
    const n = editing; if (!n) return; editing = null; n.removeAttribute("contenteditable");
    const text = n.innerText, html = n.innerHTML; const before = n.dataset.before, beforeHtml = n.dataset.beforeHtml; delete n.dataset.before; delete n.dataset.beforeHtml;
    const tpl = n.dataset.tpl !== undefined, shown = n.dataset.shown; delete n.dataset.shown;
    if (!keep || (text === before && (tpl || html === beforeHtml))) { if (tpl) n.innerText = shown; else n.innerHTML = beforeHtml; send({ t: "edit-cancel" }); return; }
    // inline elements added or removed (bold made, undone): the numbering after it moves — the frame must be redrawn
    const structural = String(n.querySelectorAll("*").length) !== n.dataset.kids; delete n.dataset.kids;
    send({ t: "text", tid: tidOf(n), text, template: tpl, ...(tpl ? {} : { html }), structural });
  };
  const sibling = (d) => {
    if (!sel) return;
    const sibs = kidsOf(sel.parentElement.closest(":not(dc-for):not(dc-if)") || sel.parentElement), i = sibs.indexOf(sel);
    const n = sibs[(i + d + sibs.length) % sibs.length]; if (n) select(n);
  };
  // pasting into a text: its words only, never someone else's markup
  document.addEventListener("paste", (e) => { if (!editing) return; e.preventDefault(); document.execCommand("insertText", false, e.clipboardData?.getData("text/plain") ?? ""); }, true);
  document.addEventListener("keydown", (e) => {
    if (editing) {
      if (e.key === "Escape") { e.preventDefault(); finishEdit(false); }
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); finishEdit(true); }
      // ⌘B ⌘I ⌘U: inline markup on the selected words (not in a template, which stays plain)
      const fmt = { b: "bold", i: "italic", u: "underline" }[e.key.toLowerCase()];
      if ((e.metaKey || e.ctrlKey) && fmt && editing.contentEditable === "true") { e.preventDefault(); document.execCommand("styleWithCSS", false, "false"); document.execCommand(fmt); }
      return;
    }
    if (e.key === "Escape") select(null);
    if (e.key === "Tab" && sel) { e.preventDefault(); sibling(e.shiftKey ? -1 : 1); return; }
    if (e.key === "Enter" && e.shiftKey && sel) { e.preventDefault(); select(parentOf(sel)); }
    else if (e.key === "Enter" && sel && isText(sel)) { e.preventDefault(); startEdit(sel); }
    else if (e.key === "Enter" && sel) { e.preventDefault(); const k = kidsOf(sel)[0]; if (k) select(k); }
    // the canvas's own shortcuts (undo, duplicate, fit, group, z-order) — not the browser's (⌘[ is "back")
    if ((e.metaKey || e.ctrlKey) && /^[zd0g[\]]$/i.test(e.key)) e.preventDefault();
    send({ t: "key", key: e.key, meta: e.metaKey || e.ctrlKey, shift: e.shiftKey, alt: e.altKey, repeat: e.repeat });
  }, true);

  // ── export: the artboard as an SVG (its markup in a foreignObject) or a PNG drawn from it ──
  const exportAs = (fmt, k = 2) => {
    const w = document.documentElement.scrollWidth, h = document.documentElement.scrollHeight;
    const css = [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n");
    const body = document.body.cloneNode(true);
    body.querySelectorAll("script").forEach((s) => s.remove());
    body.querySelectorAll("[data-tid]").forEach((n) => { n.removeAttribute("data-tid"); n.removeAttribute("data-item"); n.removeAttribute("data-tpl"); });
    const xhtml = new XMLSerializer().serializeToString(body).replace(/^<body/, "<div").replace(/<\/body>$/, "</div>");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><foreignObject x="0" y="0" width="${w}" height="${h}"><style>${css.replace(/</g, "\\3c ")}</style>${xhtml}</foreignObject></svg>`;
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    if (fmt === "svg") return send({ t: "exported", fmt, data: url });
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas"); c.width = w * k; c.height = h * k;
      const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.scale(k, k); g.drawImage(img, 0, 0);
      try { send({ t: "exported", fmt, data: c.toDataURL("image/png") }); } catch { send({ t: "exported", fmt, error: true }); }
    };
    img.onerror = () => send({ t: "exported", fmt, error: true });
    img.src = url;
  };

  // ── messages from the host ──
  const previews = new Map();   // element -> { prop: original inline value }
  const byTids = (tids) => [...new Set(tids.flatMap(all))];
  addEventListener("message", (e) => {
    const m = e.data?.__dcvHost; if (!m) return;
    if (m.t === "clear") { if (editing) finishEdit(true); sel = null; extra = []; hov = null; }
    if (m.t === "mode") { mode = m.mode || ""; document.documentElement.style.cursor = mode === "comment" ? "crosshair" : ""; }
    if (m.t === "select") {
      // the same copy again: the element itself is that item, or sits inside it
      const w = m.item && `[data-item="${CSS.escape(m.item)}"]`;
      let n = (w && document.querySelector(`${w}[data-tid="${m.tid}"], ${w} [data-tid="${m.tid}"]`)) || first(m.tid);
      if (!n) n = markerFirst(m.tid);   // a repeat or a branch (from the layers): its first copy
      for (const i of m.sub || []) { const k = n && kidsOf(n)[i]; if (!k) break; n = k; }
      if (n) { select(n); n.scrollIntoView?.({ block: "nearest" }); }
    }
    if (m.t === "parent" && sel) select(parentOf(sel));
    if (m.t === "solo" && sel) { solo = !!m.on; report(); }
    // several tags at once (the elements painting one colour)
    if (m.t === "selectTids") { const els = [...new Set(m.tids.map(first).filter(Boolean))]; sel = els[0] || null; extra = els.slice(1); solo = true; report(); }
    if (m.t === "hover") send(hoverOf(m.tid == null ? null : first(m.tid)));
    if (m.t === "edit" && sel && isText(sel)) startEdit(sel);
    if (m.t === "preview") {
      for (const n of byTids(m.tids)) {
        const orig = previews.get(n) || {};
        // removals first: dropping a longhand after setting its shorthand would wipe that side again
        const entries = Object.entries(m.changes).sort(([, a], [, b]) => (a == null || a === "" ? 0 : 1) - (b == null || b === "" ? 0 : 1));
        for (const [p, v] of entries) { if (!(p in orig)) orig[p] = n.style.getPropertyValue(p); if (v === null || v === "") n.style.removeProperty(p); else n.style.setProperty(p, v); }
        previews.set(n, orig);
      }
      if (sel) report(true);
    }
    if (m.t === "settle") { previews.clear(); send({ t: "tree", ...facts() }); }
    if (m.t === "rollback") {
      for (const [n, orig] of previews) for (const [p, v] of Object.entries(orig)) v ? n.style.setProperty(p, v) : n.style.removeProperty(p);
      previews.clear(); if (sel) report(true);
    }
    if (m.t === "locate") {
      send({ t: "located", items: m.items.map((c) => {
        let n = c.tid >= 0 ? first(c.tid) : null;
        if (n && c.fp && words(n) !== c.fp) n = [...document.querySelectorAll("[data-tid]")].find((x) => words(x) === c.fp) || null;
        if (!n) return { id: c.id, x: null, y: null };
        const r = rectOf(n); return { id: c.id, x: r.x + r.w * c.fx, y: r.y + r.h * c.fy };
      }) });
    }
    if (m.t === "export") exportAs(m.fmt, m.scale);
  });
  addEventListener("scroll", () => { if (sel) report(true); }, { passive: true });
  if (document.readyState === "complete") ready(); else addEventListener("load", ready);
})();
