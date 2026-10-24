// The design canvas's properties panel and layers tree, built from the canvas kit (dck). Driven by data: the element's
// descriptor (what the picker probed: authored inline styles, rendered values, the parent's layout; the artboard's
// type scale, tokens and colours) → sections → rows; every row is one CSS property (or a few) with an editor. Edits
// are written inline on the element — on every copy of its tag, on every element selected — live, then saved.
(() => {
  const V = (document.currentScript && new URL(document.currentScript.src, location.href).searchParams.get("v")) || "";
  const K = window.dck, esc = K.esc;
  const TEXT_TAGS = new Set("p h1 h2 h3 h4 h5 h6 span li dt dd td th blockquote q cite label figcaption caption code pre em strong b i u s small mark sub sup a button".split(" "));
  const NO_LAYOUT = new Set("img br hr wbr input textarea select video audio iframe canvas embed object svg path line circle rect ellipse polygon polyline".split(" "));
  const SIDES = ["top", "right", "bottom", "left"], CORNERS = ["top-left", "top-right", "bottom-right", "bottom-left"];
  const PX = (v) => { const n = Number.parseFloat(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : ""; };
  const ICON = {
    row: '<path d="M5 4v16M12 4v16M19 4v16"/>', column: '<path d="M4 5h16M4 12h16M4 19h16"/>', grid: '<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>',
    text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>', heading: '<path d="M6 4v16M18 4v16M6 12h12"/>', paragraph: '<path d="M5 6h14M5 12h14M5 18h9"/>', image: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 16 5-5 5 5 3-3 5 5"/>',
    button: '<rect x="3" y="7" width="18" height="10" rx="4"/>', link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
    input: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 10v4"/>', icon: '<circle cx="12" cy="12" r="8"/>', board: '<path d="M5 3v18M19 3v18M3 5h18M3 19h18"/>',
    repeat: '<path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3"/>', cond: '<path d="M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 9a9 9 0 0 1-9 9"/>',
    component: '<path d="m12 3 4 4-4 4-4-4 4-4ZM12 13l4 4-4 4-4-4 4-4ZM3 12l4-4 4 4-4 4-4-4ZM13 12l4-4 4 4-4 4-4-4Z"/>',
  };
  const svg = (k) => `<svg class="dk-tic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[k] || '<rect x="4" y="4" width="16" height="16" rx="2"/>'}</svg>`;
  const SHADOWS = { sm: "0px 1px 2px 0px rgba(0, 0, 0, 0.08)", md: "0px 4px 12px 0px rgba(0, 0, 0, 0.12)", lg: "0px 12px 32px 0px rgba(0, 0, 0, 0.18)" };

  // ── colour: parsing, WCAG contrast, and the nearest readable shade (OKLCH lightness, chroma reduced to fit sRGB) ──
  const parseColor = (s) => {
    s = String(s || "").trim();
    let m = /^#([0-9a-f]{3,8})$/i.exec(s);
    if (m) { let h = m[1]; if (h.length <= 4) h = [...h].map((c) => c + c).join(""); return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 }; }
    m = /rgba?\(([^)]+)\)/.exec(s);
    if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; }
    return null;
  };
  const toHex = (c) => "#" + [c.r, c.g, c.b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("") + (c.a !== undefined && c.a < 1 ? Math.round(c.a * 255).toString(16).padStart(2, "0") : "");
  const hexOf = (s) => { const c = parseColor(s); return c ? toHex(c) : s; };
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const over = (fg, bg) => fg.a >= 1 ? fg : { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 };
  const toOklch = (c) => {
    const [r, g, b] = [lin(c.r), lin(c.g), lin(c.b)];
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return { L, C: Math.hypot(A, B), H: Math.atan2(B, A) };
  };
  const fromOklch = ({ L, C, H }) => {
    const A = C * Math.cos(H), B = C * Math.sin(H);
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3, m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3, s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
    const out = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
    const inGamut = out.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
    const g = (v) => { v = Math.max(0, Math.min(1, v)); return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055); };
    return { c: { r: g(out[0]), g: g(out[1]), b: g(out[2]), a: 1 }, inGamut };
  };
  const inSrgb = (L, C, H) => { let lo = 0, hi = C; if (fromOklch({ L, C, H }).inGamut) return fromOklch({ L, C, H }).c; for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (fromOklch({ L, C: mid, H }).inGamut) lo = mid; else hi = mid; } return fromOklch({ L, C: lo, H }).c; };
  const readable = (fg, ground, min) => {
    const o = toOklch(fg), dark = lum(ground) > 0.18;
    let lo = o.L, hi = dark ? 0 : 1;   // move lightness away from the ground only as far as needed
    if (ratio(inSrgb(hi, o.C, o.H), ground) < min) return toHex(inSrgb(hi, o.C, o.H));
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (ratio(inSrgb(mid, o.C, o.H), ground) >= min + 0.05) hi = mid; else lo = mid; }
    return toHex(inSrgb(hi, o.C, o.H));
  };

  // ── CSS values the compound editors read and write ──
  const splitTop = (s) => { const out = []; let d = 0, buf = ""; for (const ch of s) { if (ch === "(") d++; if (ch === ")") d--; if (ch === "," && !d) { out.push(buf.trim()); buf = ""; } else buf += ch; } if (buf.trim()) out.push(buf.trim()); return out; };
  const COLOR_RE = /(rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)|var\([^)]*\)|#[0-9a-f]{3,8}\b|\b[a-z]+\b(?<!px|em|rem|inset))/i;
  const parseShadow = (s) => {
    if (!s || s === "none") return null;
    let one = splitTop(s)[0];
    const inset = /\binset\b/.test(one); one = one.replace(/\binset\b/, "");
    const cm = COLOR_RE.exec(one), color = cm ? cm[1] : "rgba(0, 0, 0, 0.15)";
    const n = (cm ? one.replace(cm[1], "") : one).trim().split(/\s+/).map((x) => Number.parseFloat(x)).filter(Number.isFinite);
    return { x: n[0] ?? 0, y: n[1] ?? 0, b: n[2] ?? 0, s: n[3] ?? 0, color, inset };
  };
  const shadowCss = (o) => `${o.inset ? "inset " : ""}${o.x}px ${o.y}px ${o.b}px ${o.s}px ${o.color}`;
  const ANGLES = { "to top": 0, "to right": 90, "to bottom": 180, "to left": 270 };
  const parseGradient = (s) => {
    const m = /linear-gradient\((.*)\)/.exec(s || ""); if (!m) return null;
    const parts = splitTop(m[1]);
    let angle = 180;
    if (/deg$/.test(parts[0]) || ANGLES[parts[0]] !== undefined) { const p = parts.shift(); angle = ANGLES[p] ?? Number.parseFloat(p); }
    const stops = parts.map((p) => p.replace(/\s+-?[\d.]+%$/, "").trim());
    return { angle, a: stops[0] || "#ffffff", b: stops[stops.length - 1] || "#000000" };
  };
  const urlOf = (s) => /url\(\s*["']?(.*?)["']?\s*\)/.exec(s || "")?.[1] || "";
  // an image the person picked, made small enough to live in the artboard's file
  const shrink = async (file) => {
    if (file.type === "image/svg+xml") { if (file.size > 300_000) throw new Error("big"); return `data:image/svg+xml;base64,${btoa(String.fromCharCode(...new Uint8Array(await file.arrayBuffer())))}`; }
    const bmp = await createImageBitmap(file);
    for (const max of [1600, 1200, 900, 600]) {
      const k = Math.min(1, max / Math.max(bmp.width, bmp.height)), c = document.createElement("canvas");
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      const url = file.type === "image/png" && max >= 1200 ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.84);
      if (url.length < 340_000) return url;
    }
    throw new Error("big");
  };
  const pickFile = () => new Promise((res) => { const i = document.createElement("input"); i.type = "file"; i.accept = "image/*"; i.onchange = () => res(i.files?.[0] || null); i.click(); });

  // keyed by version: the host script of the same version builds its panel with this one
  window.__dcvPanel = (window.__dcvPanels ||= {})[V] = (root, host) => {
    const L = () => JSON.parse(root.dataset.l || "{}");
    let l = L();
    const el = root.querySelector(".dcv-panel");
    const kindName = (k) => l[`k_${k}`] || l.k_box;
    let cur = null, autoFor = "", facts = new Map(), open = new Map(), shown = new Set(), wide = new Set(), layersOpen = localStorage.getItem("dcv-layers") !== "0";
    const factsOf = () => facts.get(cur?.board.dataset.file) || {};

    // ── the schema: one row = one CSS property and its editor ──
    const num = (prop, label, o = {}) => ({ prop, label, ed: "num", unit: "px", step: 1, ...o });
    const sel = (prop, label, options, o = {}) => ({ prop, label, ed: "select", options, ...o });
    const seg = (prop, label, options, o = {}) => ({ prop, label, ed: "seg", options, ...o });
    function sections(d) {
      const { tag, info } = d, a = d.probe.authored, c = d.probe.computed, pd = d.probe.parent?.display || "";
      const textual = d.textual || TEXT_TAGS.has(tag);
      const disp = a.display || "";
      const out = [];
      if (info.data) out.push({ id: "data", title: l.s_data, rows: Object.keys(info.data.fields).map((k) => ({ prop: `@data.${k}`, label: k, ed: "datum", key: k })) });
      if (tag === "a") out.push({ id: "link", title: l.s_link, rows: [{ prop: "@href", label: l.link, ed: "link" }] });
      if (tag === "img") out.push({ id: "image", title: l.f_image, rows: [{ prop: "@src", label: l.f_image, ed: "img" }, { prop: "@alt", label: l.alt, ed: "attr" }, sel("object-fit", l.fit, [["cover", l.cover], ["contain", l.contain], ["fill", l.stretch]])] });
      const size = [{ prop: "width", label: l.width, ed: "size", axis: "w" }, { prop: "height", label: l.height, ed: "size", axis: "h" }];
      if (info.abs) size.unshift(num("left", "X"), num("top", "Y"));
      if (pd.includes("flex")) size.push(num("flex-grow", l.grow, { unit: "", min: 0 }));
      if (pd.includes("grid")) size.push({ prop: "grid-column", label: l.span, ed: "span" });
      size.push(num("min-width", l.minW, { lt: 1, min: 0 }), num("max-width", l.maxW, { lt: 1, min: 0 }), num("min-height", l.minH, { lt: 1, min: 0 }), num("max-height", l.maxH, { lt: 1, min: 0 }));
      out.push({ id: "size", title: l.s_size, rows: size });
      const canLayout = !NO_LAYOUT.has(tag) && (!textual || /flex|grid/.test(disp) || /flex|grid/.test(c.display));
      if (canLayout) {
        const mode = /grid/.test(c.display) ? "grid" : /flex/.test(c.display) ? "flex" : "block";
        const rows = [sel("display", l.display, [["block", l.block], ["flex", l.stack], ["grid", l.grid]], { value: mode })];
        if (mode === "flex") rows.push(seg("flex-direction", l.direction, [["column", l.down, "↓"], ["row", l.across, "→"]], { value: c["flex-direction"].startsWith("column") ? "column" : "row" }),
          sel("align-items", l.align, [["flex-start", l.start], ["center", l.center], ["flex-end", l.end], ["stretch", l.stretch]], { value: ({ normal: "stretch", start: "flex-start", end: "flex-end" })[c["align-items"]] || c["align-items"] }),
          sel("justify-content", l.justify, [["flex-start", l.start], ["center", l.center], ["flex-end", l.end], ["space-between", l.between]], { value: ({ normal: "flex-start", start: "flex-start", end: "flex-end" })[c["justify-content"]] || c["justify-content"] }),
          num("gap", l.gap, { min: 0 }), sel("flex-wrap", l.wrap, [["nowrap", l.none], ["wrap", l.wrap]], { lt: 1 }));
        if (mode === "grid") rows.push({ prop: "grid-template-columns", label: l.columns, ed: "cols" }, num("gap", l.gap, { min: 0 }));
        rows.push({ prop: "padding", label: l.padding, ed: "sides" }, { prop: "margin", label: l.margin, ed: "sides", lt: 1 });
        out.push({ id: "layout", title: l.s_layout, rows });
      }
      if (textual) out.push({ id: "text", title: l.s_text, rows: [
        ...(factsOf().scale?.length ? [{ prop: "@style", label: l.ts_style, ed: "type" }] : []),
        num("font-size", l.fsize, { min: 1 }),
        sel("font-weight", l.weight, [["300", "300 Light"], ["400", "400 Regular"], ["500", "500 Medium"], ["600", "600 Semibold"], ["700", "700 Bold"], ["800", "800 Extra bold"]]),
        num("line-height", l.lh, { unit: "", step: 0.05, min: 0, read: () => { const fs = Number.parseFloat(c["font-size"]), lh = Number.parseFloat(c["line-height"]); return a["line-height"] ?? (lh && fs ? String(Math.round((lh / fs) * 100) / 100) : ""); } }),
        num("letter-spacing", l.ls, { step: 0.1 }),
        { prop: "color", label: l.color, ed: "color", contrast: true },
        seg("text-align", l.talign, [["left", l.left, "⇤"], ["center", l.center, "↔"], ["right", l.right, "⇥"]], { value: c["text-align"] === "start" ? "left" : c["text-align"] }),
        sel("text-transform", l.case, [["none", l.none], ["uppercase", l.upper], ["lowercase", l.lower], ["capitalize", l.capital]], { lt: 1 }),
      ] });
      const bw = Number.parseFloat(c["border-top-width"]) > 0 && c["border-top-style"] !== "none";
      out.push({ id: "look", title: l.s_look, rows: [
        { prop: "background", label: l.bg, ed: "fill" },
        num("opacity", l.opacity, { unit: "", step: 0.05, min: 0, max: 1 }),
        { prop: "border-radius", label: l.radius, ed: "radius" },
        num("border-width", l.bwidth, { min: 0, read: () => a["border-width"] ?? (bw ? PX(c["border-top-width"]) : "") }),
        ...(bw ? [sel("border-style", l.bstyle, [["solid", l.solid], ["dashed", l.dashed], ["dotted", l.dotted]], { value: c["border-top-style"] }), { prop: "border-color", label: l.bcolor, ed: "color", read: () => c["border-top-color"] }] : []),
      ] });
      out.push({ id: "effects", title: l.s_effects, rows: [{ prop: "box-shadow", label: l.shadow, ed: "shadow", lt: !(a["box-shadow"] || (c["box-shadow"] && c["box-shadow"] !== "none")) }, sel("overflow", l.overflow, [["visible", l.ov_visible], ["hidden", l.ov_hidden], ["auto", l.ov_auto]], { lt: 1 }), num("z-index", l.z, { unit: "", lt: 1 })] });
      return out;
    }
    const KNOWN = new Set(["width", "height", "min-width", "max-width", "min-height", "max-height", "flex-grow", "grid-column", "display", "flex-direction", "align-items", "justify-content", "gap", "flex-wrap", "grid-template-columns",
      "padding", "margin", ...SIDES.map((s) => `padding-${s}`), ...SIDES.map((s) => `margin-${s}`), "font-size", "font-weight", "line-height", "letter-spacing", "color", "text-align", "text-transform",
      "background", "background-color", "background-image", "background-size", "background-position", "background-repeat", "opacity", "border-radius", ...CORNERS.map((k) => `border-${k}-radius`),
      "border-width", "border-style", "border-color", "border", "box-shadow", "overflow", "z-index", "object-fit", "left", "top"]);
    const GROUP = { sides: (p) => [p, ...SIDES.map((s) => `${p}-${s}`)], radius: () => ["border-radius", ...CORNERS.map((k) => `border-${k}-radius`)], fill: () => ["background", "background-color", "background-image"] };
    const propsOf = (row) => GROUP[row.ed]?.(row.prop) || [row.prop];
    const isSet = (row, a) => propsOf(row).some((p) => a[p] !== undefined);
    const isMixed = (row, d) => propsOf(row).some((p) => d.probe.mixed?.includes(p));
    const visible = (row, a) => !row.lt || isSet(row, a) || shown.has(row.prop);

    // ── rendering ──
    const field = (row, d) => {
      const a = d.probe.authored, c = d.probe.computed, set = isSet(row, a), mixed = isMixed(row, d), M = l.mixed;
      const val = row.read ? row.read() : a[row.prop];
      const r = (control, o = {}) => K.row(row.label, control, { prop: row.prop, ...o });
      switch (row.ed) {
        case "num": {
          const v = mixed ? "" : set || row.read ? (row.unit === "px" ? String(val ?? "").replace(/px$/, "") : val ?? "") : "";
          return r(K.input({ value: v, placeholder: mixed ? M : row.unit === "px" ? PX(c[row.prop]) : c[row.prop] ?? "", "data-prop": row.prop, "data-unit": row.unit, "data-step": row.step, "data-min": row.min, "data-max": row.max }), { scrub: true });
        }
        case "select": {
          const v = mixed ? M : set ? val : row.value ?? c[row.prop];
          return r(K.select({ options: row.options, value: v, inh: !set || mixed, "data-prop": row.prop }));
        }
        case "seg": return r(K.seg({ options: row.options, value: mixed ? null : set ? val : row.value, inh: !set, data: { "data-prop": row.prop } }));
        case "size": {
          const v = a[row.prop], mode = !v || v === "auto" ? "hug" : v === "100%" ? "fill" : "fixed";
          return r(K.pair(K.input({ value: mode === "fixed" && !mixed ? String(v).replace(/px$/, "") : "", placeholder: mixed ? M : d.probe.size[row.axis], "data-prop": row.prop, "data-unit": "px", "data-step": 1, "data-min": 0 }),
            K.select({ options: [["hug", l.hug], ["fixed", l.fixed], ["fill", l.fill]], value: mode, "data-size": row.prop }), true), { scrub: true });
        }
        case "span": return r(K.input({ value: /span\s+(\d+)/.exec(a["grid-column"] || "")?.[1] ?? "", placeholder: "1", "data-prop": "grid-column", "data-span": "1" }));
        case "cols": {
          const n = /repeat\(\s*(\d+)/.exec(a["grid-template-columns"] || "")?.[1] ?? (c["grid-template-columns"] && c["grid-template-columns"] !== "none" ? String(c["grid-template-columns"].split(/\s+/).length) : "");
          return r(K.input({ value: n, placeholder: "1", "data-prop": "grid-template-columns", "data-cols": "1" }));
        }
        case "sides": {
          // two fields (vertical, horizontal) until the sides differ or the person asks for four
          const vals = SIDES.map((s) => PX(c[`${row.prop}-${s}`])), four = wide.has(row.prop) || vals[0] !== vals[2] || vals[1] !== vals[3];
          const inp = (v, name, attrs) => K.input({ value: mixed ? "" : v, placeholder: mixed ? M : "0", center: true, inh: !set, "aria-label": `${row.label}: ${name}`, title: name, ...attrs });
          const box = four ? `<div class="dk-quad" data-sides="${row.prop}">${SIDES.map((s, i) => inp(vals[i], l[`side_${s}`], { "data-side": s })).join("")}</div>`
            : `<div class="dk-pair" data-sides="${row.prop}">${inp(vals[0], l.vert, { "data-axis": "v" })}${inp(vals[1], l.horiz, { "data-axis": "h" })}</div>`;
          const caps = four ? ["↑", "→", "↓", "←"] : ["↕", "↔"];
          return K.row(row.label, `<div>${K.withButton(box, K.ib({ icon: "corners", label: l.eachSide, field: true, pressed: four, "data-wide": row.prop }))}<div class="dk-cap dk-cap-b${four ? "" : " dk-two"}">${caps.map((x) => `<span>${esc(x)}</span>`).join("")}</div></div>`, { top: true });
        }
        case "radius": {
          const vals = CORNERS.map((k) => PX(c[`border-${k}-radius`])), four = wide.has("radius") || new Set(vals).size > 1;
          const one = a["border-radius"] && !/\s/.test(a["border-radius"]) ? String(a["border-radius"]).replace(/px$/, "") : vals[0];
          const box = four ? `<div class="dk-quad" data-corners="1">${CORNERS.map((k, i) => K.input({ value: mixed ? "" : vals[i], placeholder: mixed ? M : "0", center: true, inh: !set, "data-corner": k, "aria-label": `${row.label} ${l[`c_${k}`]}` })).join("")}</div>`
            : K.input({ value: mixed ? "" : set ? one : "", placeholder: mixed ? M : String(vals[0]), "data-prop": "border-radius", "data-unit": "px", "data-step": 1, "data-min": 0 });
          return K.row(row.label, K.withButton(box, K.ib({ icon: "corners", label: l.eachCorner, field: true, pressed: four, "data-wide": "radius" })), { scrub: !four, prop: "border-radius" });
        }
        case "color": return colorField(row.prop, row.label, val ?? (set ? a[row.prop] : c[row.prop]), set, mixed, row.contrast ? d : null);
        case "fill": return fillField(d, set, mixed);
        case "shadow": return shadowField(d);
        case "type": return typeField(d);
        case "link": {
          const href = cur.info.href || "", list = host.boards(), known = !href || list.some((b) => b.file === href);
          return K.row(row.label, K.select({ options: [["", l.noLink], ...list.map((b) => [b.file, b.title]), ...(known ? [] : [[href, href]])], value: href, inh: !href, "data-link": "1" }));
        }
        case "img": return K.row(row.label, `${K.split(`<span class="dcp-thumb" style="background-image:url(&quot;${esc(cur.info.src || "")}&quot;)"></span>`, K.btn({ label: l.replace, icon: "image", "data-upload": "src" }))}`);
        case "attr": return K.row(row.label, K.input({ value: "", placeholder: l.altPh, "data-attr": row.prop.slice(1) }));
        case "datum": {
          const v = cur.info.data.fields[row.key];
          return typeof v === "boolean" ? K.row(row.label, K.check({ label: v ? l.yes : l.no, checked: v, "data-datum": row.key })) : K.row(row.label, K.input({ value: v ?? "", "data-datum": row.key }), { title: `{{…${row.key}}}` });
        }
      }
      return "";
    };
    const colorField = (prop, label, raw, set, mixed, d) => {
      const col = parseColor(raw), hex = col && (set || col.a > 0) ? toHex(col) : "";
      const shown = mixed ? "" : set ? (col && !/var\(/.test(raw) ? toHex(col) : raw) : "";
      let extra = "";
      if (d && col && d.probe.ground && !mixed) {
        const g = d.probe.ground, c = d.probe.computed, fs = Number.parseFloat(c["font-size"]), fw = Number(c["font-weight"]) || 400;
        const min = fs >= 24 || (fs >= 18.66 && fw >= 700) ? 3 : 4.5, r = ratio(over(col, g), g);
        extra = r >= min ? K.note("ok", esc(l.contrastOk.replace("{r}", r.toFixed(1))))
          : K.note("bad", `${esc(l.contrastBad.replace("{r}", r.toFixed(1)).replace("{bg}", toHex(g)).replace("{min}", String(min)))}<br>${K.link({ label: l.readable, "data-readable": readable(col, g, min), "data-for": prop })}`);
      }
      const ctl = K.color({ swatch: K.swatch({ color: hex, label: label || l.color, "data-swatch": prop }), field: K.input({ value: shown, placeholder: mixed ? l.mixed : hex || l.none, "data-prop": prop, "data-raw": "1" }), inh: !set });
      return (label ? K.row(label, ctl) : K.sub(ctl)) + extra;
    };
    const fillField = (d, set, mixed) => {
      const a = d.probe.authored, c = d.probe.computed, bi = c["background-image"] || "none";
      const mode = /gradient/.test(bi) ? "gradient" : /url\(/.test(bi) ? "image" : "color";
      const head = K.row(l.bg, K.select({ options: [["color", l.f_color], ["gradient", l.f_grad], ["image", l.f_image]], value: mode, "data-fill": "1" }));
      if (mode === "color") return head + colorField("background-color", "", a["background-color"] ?? (a.background && !/gradient|url\(/.test(a.background) ? a.background : undefined) ?? c["background-color"], set, mixed, null);
      if (mode === "gradient") {
        const g = parseGradient(a["background-image"] || a.background || bi) || { angle: 180, a: "#ffffff", b: "#000000" };
        const stop = (k, v) => K.color({ swatch: K.swatch({ color: hexOf(v), label: l.stop, "data-swatch": `@grad-${k}` }), field: K.input({ value: /var\(/.test(v) ? v : hexOf(v), "data-grad": k, "data-raw": "1" }) });
        return head + K.row(l.g_from, stop("a", g.a)) + K.row(l.g_to, stop("b", g.b)) + K.row(l.angle, K.input({ value: String(g.angle), "data-grad": "angle", "data-unit": "", "data-step": 15 }), { scrub: true, prop: "@angle" });
      }
      const url = urlOf(a["background-image"] || a.background || bi);
      return head + K.sub(K.split(`<span class="dcp-thumb" style="background-image:url(&quot;${esc(url.slice(0, 200000))}&quot;)"></span>`, K.btn({ label: l.replace, icon: "image", "data-upload": "background" })))
        + K.row(l.fit, K.select({ options: [["cover", l.cover], ["contain", l.contain], ["auto", l.natural]], value: a["background-size"] || c["background-size"] || "cover", "data-prop": "background-size" }));
    };
    const shadowField = (d) => {
      const a = d.probe.authored, c = d.probe.computed, sh = parseShadow(a["box-shadow"] ?? (c["box-shadow"] !== "none" ? c["box-shadow"] : ""));
      const norm = (s) => String(s).replace(/\s+/g, " ").trim();
      const preset = !sh ? "none" : Object.entries(SHADOWS).find(([, v]) => norm(v) === norm(a["box-shadow"] || ""))?.[0] || "custom";
      let html = K.row(l.shadow, K.select({ options: [["none", l.none], ["sm", l.sh_sm], ["md", l.sh_md], ["lg", l.sh_lg], ...(preset === "custom" ? [["custom", l.sh_custom]] : [])], value: preset, inh: !a["box-shadow"], "data-shadow": "1" }));
      const f = (k) => K.input({ value: String(sh[k]), "data-sh": k, "data-step": 1, "aria-label": l[`sh_${k}`], title: l[`sh_${k}`] });
      if (sh) html += K.row(l.sh_offset, K.pair(f("x"), f("y"))) + K.row(l.sh_b, f("b"), { scrub: true, prop: "@sh-b" }) + K.row(l.sh_s, f("s"), { scrub: true, prop: "@sh-s" })
        + K.row(l.color, K.color({ swatch: K.swatch({ color: hexOf(sh.color), label: l.color, "data-swatch": "@shadow" }), field: K.input({ value: /var\(/.test(sh.color) ? sh.color : hexOf(sh.color), "data-sh": "color", "data-raw": "1" }) }));
      return html;
    };
    const roleName = (r) => r.role === "h" ? l.ts_h.replace("{n}", r.n) : l[`ts_${r.role}`] || r.role;
    const typeField = (d) => {
      const c = d.probe.computed, list = factsOf().scale || [];
      const fs = `${Math.round(Number.parseFloat(c["font-size"]) * 2) / 2}px`, i = list.findIndex((r) => r.size === fs && String(r.weight) === String(c["font-weight"]));
      return K.row(l.ts_style, K.select({ options: [...list.map((r, k) => [String(k), `${roleName(r)} · ${Number.parseFloat(r.size)}`]), ["", l.ts_custom]], value: i >= 0 ? String(i) : "", inh: i < 0, "data-type": "1" }));
    };
    const sectionHtml = (s, d) => {
      const a = d.probe.authored, rows = s.rows.filter((r) => visible(r, a)), hidden = s.rows.filter((r) => !visible(r, a));
      if (!rows.length && !hidden.length) return "";
      return K.section({ id: s.id, title: s.title, add: hidden.length > 0, addLabel: l.add, body: rows.map((r) => field(r, d)).join("") });
    };
    // every colour inside the selection (the whole artboard when it is selected): change one and it changes wherever
    // it paints; the target selects the elements it paints
    let colorsShown = [];
    const colorsHtml = (list) => {
      colorsShown = list || [];
      if (colorsShown.length < 1) return "";
      return K.section({ id: "colors", title: l.s_colors, body: colorsShown.map((c, i) => K.colorRow({
        swatch: K.swatch({ color: c.hex, label: c.hex, "data-swatch": `@recolor-${i}` }),
        field: K.input({ value: c.hex.replace(/^#/, "").toUpperCase(), "data-recolor": i, "aria-label": c.hex }),
        count: c.n, target: K.ib({ icon: "target", label: l.selectThese.replace("{n}", c.n), "data-target": i }),
      })).join("") });
    };
    const advancedHtml = (d) => {
      const a = d.probe.authored, extra = Object.keys(a).filter((p) => !KNOWN.has(p));
      const body = extra.map((p) => `<div class="dk-row" title="${esc(l.stale)}"><span class="dk-l dk-raw">${esc(p)}</span>${K.input({ value: a[p], "data-prop": p, "data-raw": "1" })}</div>`).join("") + K.input({ placeholder: `${l.addRaw}: value`, cls: "dcp-rawadd" });
      return K.fold({ title: `${l.advanced}${extra.length ? ` · ${extra.length}` : ""}`, open: extra.length > 0, cls: "dcp-adv", body: `<div class="dcp-adv-b">${body}</div>` });
    };
    const layersHtml = (board, focus) => {
      const t = factsOf().tree || [], op = open.get(board.dataset.file) || new Set(), also = new Set(cur.tids || []);
      // the selection's ancestors are open
      const fk = `${board.dataset.file}:${focus}`;
      if (focus != null && autoFor !== fk) { autoFor = fk; const at = t.findIndex((n) => n.tid === focus); let dep = at >= 0 ? t[at].depth : 0; for (let i = at - 1; i >= 0 && dep > 0; i--) if (t[i].depth < dep) { op.add(t[i].tid); dep = t[i].depth; } }
      open.set(board.dataset.file, op);
      const rows = []; let hideBelow = Infinity;
      for (const n of t) {
        if (n.depth > hideBelow) continue;
        hideBelow = n.kids && !op.has(n.tid) ? n.depth : Infinity;
        const name = n.kind === "repeat" ? `${l.k_repeat} · ${n.text}` : kindName(n.kind);
        rows.push(K.treeRow({ depth: n.depth, open: n.kids ? op.has(n.tid) : null, tw: n.tid, ic: svg(n.kind), name, text: n.kind === "repeat" ? "" : n.text, on: n.tid === focus, also: n.tid !== focus && also.has(n.tid), "data-tid": n.tid }));
        if (rows.length > 400) break;
      }
      return K.fold({ title: l.layers, open: layersOpen, cls: "dcl", body: `<div class="dcl-list dk-tree">${K.treeRow({ root: true, ic: svg("board"), name: board.dataset.title, on: focus == null, "data-board": "1" })}${rows.join("")}</div>` });
    };
    function render() {
      l = L();
      if (!cur) { el.hidden = true; root.classList.remove("with-panel"); return; }
      const { board, info } = cur, n = cur.own?.length || 1, copies = info.copies || 1;
      const title = info.tag === "artboard" ? board.dataset.title : n > 1 ? l.nElements.replace("{n}", n) : `${kindName(info.kind || "box")}${info.text ? ` «${info.text}»` : ""}`;
      const head = `<div class="dcp-h"><span class="dcp-t">${esc(title)}</span>${K.ib({ icon: "x", label: l.close, "data-dcp": "close" })}</div>`;
      const same = info.same || copies, own = cur.own?.length || 1;
      const note = info.tag === "artboard" ? "" : own > 1 ? K.banner(esc(l.multiBanner.replace("{n}", own)))
        : same > 1 ? K.banner(esc(l.sameBanner.replace(/\{n\}/g, same) + (info.data ? ` ${l.rowDataHint}` : "")))
        : info.solo ? K.banner(esc(l.soloBanner)) : info.import ? K.banner(esc(l.instanceBanner)) : "";
      let body = "";
      if (info.tag === "artboard") {
        body = K.section({ id: "board", title: l.s_size, body: K.row(l.width, K.input({ value: board.offsetWidth, "data-board": "w" })) + K.row(l.height, K.input({ value: board.offsetHeight, "data-board": "h" })) }) + colorsHtml(factsOf().colors);
      } else if (cur.probe) {
        const d = { tag: info.tag, textual: info.textual, info, probe: cur.probe };
        cur.sections = sections(d);
        body = cur.sections.map((s) => sectionHtml(s, d)).join("") + colorsHtml(info.colors) + advancedHtml(d);
      }
      el.innerHTML = head + note + `<div class="dcp-b">${layersHtml(board, info.tag === "artboard" ? null : info.tid)}${body}</div>`;
      el.hidden = false; root.classList.add("with-panel");
      el.querySelector(".dk-tr.dk-on")?.scrollIntoView({ block: "nearest" });
    }

    // ── writing: preview while typing or scrubbing, save on Enter / blur / release ──
    const norm = (inp, text) => {
      const t = String(text).trim();
      if (t === "") return null;
      if (inp.dataset.span) return /^\d+$/.test(t) ? `span ${t}` : t;
      if (inp.dataset.cols) return /^\d+$/.test(t) ? `repeat(${t}, minmax(0, 1fr))` : t;
      if (/^-?\d*\.?\d+$/.test(t)) {
        let n = Number(t); if (inp.dataset.min !== undefined) n = Math.max(Number(inp.dataset.min), n); if (inp.dataset.max !== undefined) n = Math.min(Number(inp.dataset.max), n);
        return `${Math.round(n * 1000) / 1000}${inp.dataset.unit || ""}`;
      }
      return t;
    };
    const px = (v) => { const t = String(v).trim(); return /^-?\d*\.?\d+$/.test(t) ? (Number(t) === 0 ? "0" : `${t}px`) : t; };
    // the four sides (or two axes) as one shorthand; an empty field keeps what it shows
    const sidesValue = (box) => {
      const get = (i) => px(i.value.trim() || i.placeholder || "0");
      const ins = [...box.querySelectorAll("input")];
      const [t, r, b, lft] = box.querySelector("[data-axis]") ? [get(ins[0]), get(ins[1]), get(ins[0]), get(ins[1])] : ins.map(get);
      return t === b && r === lft ? (t === r ? t : `${t} ${r}`) : `${t} ${r} ${b} ${lft}`;
    };
    const valid = (v) => v.split(/\s+/).every((x) => /^-?\d*\.?\d+(px|%|em|rem)?$/.test(x) || /^(auto|0)$/.test(x));
    const shadowFrom = () => {
      const g = (k) => el.querySelector(`[data-sh="${k}"]`)?.value.trim() || "0";
      return shadowCss({ x: Number.parseFloat(g("x")) || 0, y: Number.parseFloat(g("y")) || 0, b: Math.max(0, Number.parseFloat(g("b")) || 0), s: Number.parseFloat(g("s")) || 0, color: g("color") === "0" ? "rgba(0, 0, 0, 0.15)" : g("color"), inset: /inset/.test(cur.probe.authored["box-shadow"] || "") });
    };
    const gradFrom = () => {
      const g = (k) => el.querySelector(`[data-grad="${k}"]`)?.value.trim();
      return `linear-gradient(${Number.parseFloat(g("angle")) || 0}deg, ${g("a") || "#ffffff"}, ${g("b") || "#000000"})`;
    };
    const fillReset = () => (cur.probe.authored.background !== undefined ? { background: null } : {});
    const changesFor = (inp) => {
      const box = inp.closest("[data-sides]");
      if (box) { const p = box.dataset.sides, v = sidesValue(box); return valid(v) ? { [p]: v, ...Object.fromEntries(SIDES.map((s) => [`${p}-${s}`, null])) } : null; }
      if (inp.closest("[data-corners]")) {
        const v = [...el.querySelectorAll("[data-corner]")].map((i) => px(i.value.trim() || i.placeholder || "0"));
        const short = new Set(v).size === 1 ? v[0] : v.join(" ");
        return valid(short) ? { "border-radius": short, ...Object.fromEntries(CORNERS.map((k) => [`border-${k}-radius`, null])) } : null;
      }
      if (inp.dataset.sh) return { "box-shadow": shadowFrom() };
      if (inp.dataset.grad) return { "background-image": gradFrom(), ...fillReset() };
      const p = inp.dataset.prop; if (!p) return null;
      const v = inp.dataset.raw ? (inp.value.trim() || null) : norm(inp, inp.value);
      const ch = { [p]: v };
      if (p === "border-radius") Object.assign(ch, Object.fromEntries(CORNERS.map((k) => [`border-${k}-radius`, null])));
      if (p === "background-color") Object.assign(ch, fillReset());
      if (p === "border-width" && v && !cur.probe.authored["border-style"] && cur.probe.computed["border-top-style"] === "none") Object.assign(ch, { "border-style": "solid", "border-color": cur.probe.authored["border-color"] ?? "#e5e5e5" });
      return ch;
    };
    const editable = (t) => t.matches?.(".dk-input") && !t.matches(".dcp-rawadd") && !t.dataset.board && !t.dataset.attr && !t.dataset.datum && t.dataset.recolor === undefined;
    el.addEventListener("input", (e) => {
      const r = e.target.dataset?.recolor; if (r !== undefined) { const c = colorsShown[Number(r)], v = e.target.value.trim(); if (c && /^#?[0-9a-f]{6}$/i.test(v)) host.recolor(c.uses, v.startsWith("#") ? v : `#${v}`, false); return; }
      const ch = editable(e.target) ? changesFor(e.target) : null; if (ch) host.change(ch, false); });
    el.addEventListener("change", async (e) => {
      const t = e.target;
      if (t.dataset.fill) return fillMode(t.value);
      if (t.dataset.size) { const p = t.dataset.size, m = t.value; return host.change({ [p]: m === "hug" ? null : m === "fill" ? "100%" : `${cur.probe.size[p === "width" ? "w" : "h"]}px` }, true); }
      if (t.dataset.shadow) return host.change({ "box-shadow": t.value === "none" ? null : SHADOWS[t.value] ?? cur.probe.authored["box-shadow"] ?? null }, true);
      if (t.dataset.type) { const r = (factsOf().scale || [])[Number(t.value)]; if (r) host.change({ "font-size": r.size, "font-weight": String(r.weight), "line-height": r.lh || null, "letter-spacing": r.ls || null }, true); return; }
      if (t.dataset.link !== undefined && t.matches("select")) return host.attr("href", t.value || null);
      if (t.dataset.attr) return host.attr(t.dataset.attr, t.value.trim() || null);
      if (t.dataset.recolor !== undefined) { const c = colorsShown[Number(t.dataset.recolor)], v = t.value.trim(); if (c && v) host.recolor(c.uses, /^[0-9a-f]{3,8}$/i.test(v) ? `#${v}` : v, true); return; }
      if (t.dataset.datum) return host.setData(`${cur.info.data.path}.${t.dataset.datum}`, t.type === "checkbox" ? String(t.checked) : t.value);
      if (t.matches("select[data-prop]")) return host.change({ [t.dataset.prop]: t.value || null }, true);
      if (t.dataset.board) return host.resizeBoard(t.dataset.board, Number(t.value));
      if (t.matches(".dcp-rawadd")) { const m = /^\s*(-?-?[a-z][a-z0-9-]*)\s*:\s*(.+?);?\s*$/i.exec(t.value); if (m) host.change({ [m[1].startsWith("--") ? m[1] : m[1].toLowerCase()]: m[2] }, true); t.value = ""; return; }
      if (editable(t)) { const ch = changesFor(t); if (ch) host.change(ch, true); }
    });
    el.addEventListener("keydown", (e) => {
      const t = e.target; if (!t.matches?.(".dk-input")) return;
      e.stopPropagation();
      // Enter / Esc hand the keys back to the canvas (⌘D, ⌥↑ … work right after a field)
      if (e.key === "Enter" && t.tagName === "INPUT") { t.blur(); root.querySelector(".dcv-stage").focus({ preventScroll: true }); }
      if (e.key === "Escape") { host.rollback(); t.blur(); root.querySelector(".dcv-stage").focus({ preventScroll: true }); }
      if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !t.dataset.raw && t.tagName === "INPUT") {
        const cur0 = Number.parseFloat(t.value || t.placeholder || "0"); if (!Number.isFinite(cur0)) return;
        e.preventDefault();
        const step = Number(t.dataset.step || 1) * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1);
        t.value = String(Math.round((cur0 + (e.key === "ArrowUp" ? step : -step)) * 1000) / 1000);
        const ch = changesFor(t); if (ch) host.change(ch, false);
      }
    });
    // drag a number row's label to scrub its value
    el.addEventListener("pointerdown", (e) => {
      const lab = e.target.closest(".dk-l.dk-scrub"); if (!lab) return;
      const inp = lab.parentElement.querySelector("input.dk-input"); if (!inp) return;
      e.preventDefault(); lab.setPointerCapture(e.pointerId);
      const x0 = e.clientX, v0 = Number.parseFloat(inp.value || inp.placeholder || "0") || 0, step = Number(inp.dataset.step || 1);
      let moved = false;
      const move = (ev) => { const n = Math.round((ev.clientX - x0) / 3); if (!n && !moved) return; moved = true; inp.value = String(Math.round((v0 + n * step) * 1000) / 1000); const ch = changesFor(inp); if (ch) host.change(ch, false); };
      const up = () => { lab.removeEventListener("pointermove", move); lab.removeEventListener("pointerup", up); if (moved) { const ch = changesFor(inp); if (ch) host.change(ch, true); } };
      lab.addEventListener("pointermove", move); lab.addEventListener("pointerup", up);
    });
    el.addEventListener("click", async (e) => {
      const b = e.target.closest("button, .dk-tr, summary"); if (!b) return;
      if (b.dataset.dcp === "close") return host.closePanel();
      if (b.matches(".dcl > summary")) { layersOpen = !b.parentElement.open; localStorage.setItem("dcv-layers", layersOpen ? "1" : "0"); return; }
      if (b.dataset.tw) { e.stopPropagation(); const op = open.get(cur.board.dataset.file); const tid = Number(b.dataset.tw); op.has(tid) ? op.delete(tid) : op.add(tid); render(); return; }
      if (b.matches(".dk-tr")) return b.dataset.board ? host.selectBoard() : host.selectTid(Number(b.dataset.tid));
      if (b.dataset.add) return addMenu(b);
      if (b.dataset.wide) { wide.has(b.dataset.wide) ? wide.delete(b.dataset.wide) : wide.add(b.dataset.wide); return render(); }
      if (b.dataset.val && b.dataset.prop) return host.change({ [b.dataset.prop]: b.dataset.val }, true);
      if (b.dataset.readable) return host.change({ [b.dataset.for || "color"]: b.dataset.readable }, true);
      if (b.dataset.swatch) return swatches(b);
      if (b.dataset.upload) return upload(b.dataset.upload);
      if (b.dataset.target !== undefined) { const c = colorsShown[Number(b.dataset.target)]; if (c) host.selectTids([...new Set(c.uses.map((u) => u.tid))]); return; }
    });
    el.addEventListener("mouseover", (e) => { const r = e.target.closest(".dk-tr[data-tid]"); host.hoverTid(r ? Number(r.dataset.tid) : null); });
    el.addEventListener("mouseleave", () => host.hoverTid(null));
    const fillMode = async (m) => {
      const c = cur.probe.computed, base = c["background-color"] && parseColor(c["background-color"])?.a ? hexOf(c["background-color"]) : "#ffffff";
      if (m === "color") return host.change({ "background-image": null, ...fillReset(), "background-color": base }, true);
      // from the fill to a deeper shade of it: a start that already belongs to the design
      const o = toOklch(parseColor(base)), deeper = toHex(inSrgb(Math.max(0, o.L - (o.L > 0.5 ? 0.12 : -0.12)), o.C, o.H));
      if (m === "gradient") return host.change({ "background-image": `linear-gradient(180deg, ${base}, ${deeper})`, ...fillReset() }, true);
      if (m === "image") return upload("background");
    };
    const upload = async (where) => {
      const f = await pickFile(); if (!f) return;
      let url; try { url = await shrink(f); } catch { return document.dispatchEvent(new CustomEvent("dh-toast", { detail: { title: l.tooBig, category: "error" } })); }
      if (where === "src") return host.attr("src", url);
      host.change({ "background-image": `url("${url}")`, "background-size": "cover", "background-position": "center", "background-repeat": "no-repeat", ...fillReset() }, true);
    };
    const addMenu = (b) => {
      const s = cur.sections.find((x) => x.id === b.dataset.add); if (!s) return;
      const hidden = s.rows.filter((r) => !visible(r, cur.probe.authored));
      host.menu(b.getBoundingClientRect(), hidden.map((r) => ({ label: r.label, run: () => { shown.add(r.prop); render(); el.querySelector(`[data-prop="${r.prop}"], [data-sides="${r.prop}"] input, [data-shadow]`)?.focus(); } })));
    };
    // tokens of the artboard, its colours (most used first), then the system picker for anything else
    const swatches = (b) => {
      const key = b.dataset.swatch, { palette = [], tokens = [] } = factsOf();
      const apply = (v, final) => {
        if (key === "@shadow") { const i = el.querySelector('[data-sh="color"]'); if (i) i.value = v; return host.change({ "box-shadow": shadowFrom() }, final); }
        if (key.startsWith("@recolor-")) { const c = colorsShown[Number(key.slice(9))]; if (c) host.recolor(c.uses, v, final); return; }
        if (key.startsWith("@grad-")) { const i = el.querySelector(`[data-grad="${key.slice(6)}"]`); if (i) i.value = v; return host.change({ "background-image": gradFrom(), ...fillReset() }, final); }
        host.change({ [key]: v, ...(key === "background-color" ? fillReset() : {}) }, final);
      };
      const pop = document.createElement("div"); pop.className = "dk-pop dcp-pal";
      const cur0 = toHex(parseColor(getComputedStyle(b).getPropertyValue("--c")) || { r: 0, g: 0, b: 0 }).slice(0, 7);
      pop.innerHTML = `${tokens.length ? `<div class="dk-pop-h">${esc(l.tokens)}</div><div class="dk-tokens">${tokens.map((t) => `<button type="button" class="dk-token" data-c="var(${esc(t.name)})"><span class="dk-sw" style="--c:${esc(t.hex)}"></span><span class="dk-grow">${esc(t.name.replace(/^--/, ""))}</span><span class="dk-v">${esc(t.hex)}</span></button>`).join("")}</div>` : ""}
        ${palette.length ? `<div class="dk-pop-h">${esc(l.inArtboard)}</div><div class="dk-grid8">${palette.map((h) => K.swatch({ color: h, label: h, "data-c": h })).join("")}</div>` : ""}
        <input type="color" class="dcp-native" value="${esc(cur0)}" aria-label="${esc(l.color)}">`;
      root.append(pop);
      const r = b.getBoundingClientRect(), rr = root.getBoundingClientRect();
      Object.assign(pop.style, { left: `${Math.max(4, Math.min(r.left - rr.left, rr.width - pop.offsetWidth - 4))}px`, top: `${Math.min(r.bottom - rr.top + 4, rr.height - pop.offsetHeight - 4)}px` });
      const done = (ev) => { if (ev && pop.contains(ev.target)) return; pop.remove(); removeEventListener("pointerdown", done, true); };
      setTimeout(() => addEventListener("pointerdown", done, true));
      pop.addEventListener("click", (ev) => { const c = ev.target.closest("[data-c]"); if (c) { apply(c.dataset.c, true); done(); } });
      pop.querySelector(".dcp-native").addEventListener("input", (ev) => apply(ev.target.value, false));
      pop.querySelector(".dcp-native").addEventListener("change", (ev) => { apply(ev.target.value, true); done(); });
    };

    const typing = () => el.contains(document.activeElement) && document.activeElement.matches("input, select, textarea");
    return {
      // quiet: the same element re-probed after a live preview — keep the panel as it is (a scrub or typing goes on)
      show(s, quiet) {
        const same = cur && s && cur.board === s.board && cur.info.tid === s.info.tid && cur.info.tag === s.info.tag && String(cur.tids) === String(s.tids);
        if (!same) { shown = new Set(); wide = new Set(); }
        cur = s;
        if (same && (quiet || typing())) return;
        render();
      },
      hide() { cur = null; render(); },
      tree(board, m) { facts.set(board.dataset.file, { tree: m.tree || [], palette: m.palette || [], tokens: m.tokens || [], scale: m.scale || [], colors: m.colors || [] }); if (cur && cur.board === board && !typing()) render(); },
      get open() { return !!cur; },
    };
  };
})();
