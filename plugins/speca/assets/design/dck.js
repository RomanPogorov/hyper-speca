// Design canvas kit: markup builders for the components in dck.css. Every piece of the canvas's own UI (panel,
// menus, bars, popovers, comments) is made of these — a new control is a new builder here, not ad-hoc markup.
(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // attributes from an object: true → bare, false / null / undefined → left out
  const attrs = (o = {}) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== false).map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`)).join("");
  const P = {
    chevRight: '<path d="m9 6 6 6-6 6"/>', chevDown: '<path d="m6 9 6 6 6-6"/>', plus: '<path d="M12 5v14M5 12h14"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>',
    corners: '<path d="M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3"/>',
    msg: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/>', check: '<path d="m5 12 5 5 9-10"/>', trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 16 5-5 5 5 3-3 5 5"/>', send: '<path d="M5 12h14M13 6l6 6-6 6"/>', link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
    copies: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>', one: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>', pencil: '<path d="M4 20h4L19 9l-4-4L4 16v4ZM14 6l4 4"/>', play: '<path d="M7 5v14l11-7-11-7Z"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', component: '<path d="m12 3 4 4-4 4-4-4 4-4ZM12 13l4 4-4 4-4-4 4-4ZM3 12l4-4 4 4-4 4-4-4ZM13 12l4-4 4 4-4 4-4-4Z"/>',
  };
  const icon = (k, cls = "") => `<svg${cls ? ` class="${cls}"` : ""} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[k] || ""}</svg>`;
  const cl = (...c) => c.filter(Boolean).join(" ");

  window.dck = {
    esc, attrs, icon,
    /** A text / number field. `inh`: the value shown is inherited (placeholder in the secondary colour). */
    input: ({ value = "", placeholder = "", cls = "", inh, center, ...a } = {}) =>
      `<input class="${cl("dk-input", center && "dk-c", inh && "dk-inh", cls)}"${attrs({ ...a, value: String(value ?? ""), placeholder: String(placeholder ?? ""), spellcheck: "false", autocomplete: "off" })}>`,
    textarea: ({ value = "", placeholder = "", cls = "", ...a } = {}) => `<textarea class="${cl("dk-input", cls)}"${attrs({ ...a, placeholder })}>${esc(value)}</textarea>`,
    /** A select: options [[value, label]]; a value not in the list shows as its own option. */
    select: ({ options, value, inh, cls = "", ...a }) => {
      const has = options.some(([o]) => o === value);
      return `<span class="${cl("dk-select", inh && "dk-inh", cls)}"><select${attrs(a)}>${options.map(([o, t]) => `<option value="${esc(o)}"${o === value ? " selected" : ""}>${esc(t)}</option>`).join("")}${has ? "" : `<option value="" selected>${esc(value || "—")}</option>`}</select></span>`;
    },
    /** Segmented: options [[value, label, glyph?]]; each button carries `data` plus data-val. */
    seg: ({ options, value, inh, data = {} }) =>
      `<div class="${cl("dk-seg", inh && "dk-inh")}">${options.map(([o, t, g]) => `<button type="button"${attrs({ ...data, "data-val": o, "aria-pressed": String(o === value), title: t })}>${esc(g || t)}</button>`).join("")}</div>`,
    swatch: ({ color = "", label = "", ...a } = {}) => `<button type="button" class="dk-sw"${attrs({ ...a, "aria-label": label, title: label || undefined })} style="--c:${esc(color || "transparent")}"></button>`,
    /** Swatch + field. */
    color: ({ swatch, field, inh }) => `<div class="${cl("dk-color", inh && "dk-inh")}">${swatch}${field}</div>`,
    pair: (a, b, wide) => `<div class="${cl("dk-pair", wide && "dk-wide")}">${a}${b}</div>`,
    quad: (cells, caps) => `<div class="dk-quad">${cells.join("")}</div>${caps ? `<div class="dk-cap">${caps.map((c) => `<span>${esc(c)}</span>`).join("")}</div>` : ""}`,
    /** A wide part and a part as wide as it needs (a preview and its button). */
    split: (a, b) => `<div class="dk-split">${a}${b}</div>`,
    /** A colour in a list: swatch, field, how many use it, an action. */
    colorRow: ({ swatch, field, count, target }) => `<div class="dk-crow">${swatch}${field}<span class="dk-cn">${esc(count)}</span>${target || ""}</div>`,
    withButton: (control, button) => `<div class="dk-with">${control}${button}</div>`,
    /** A labelled row. scrub: dragging the label changes the field (data-prop names it). */
    row: (label, control, { scrub, prop, title, top, cls = "" } = {}) =>
      `<div class="${cl("dk-row", top && "dk-top", cls)}"${attrs({ title })}><span class="${cl("dk-l", scrub && "dk-scrub")}"${attrs({ "data-prop": prop })}>${esc(label)}</span>${control}</div>`,
    sub: (inner) => `<div class="dk-sub">${inner}</div>`,
    section: ({ id, title, add, addLabel = "", body }) =>
      `<section class="dk-sec"${attrs({ "data-sec": id })}><div class="dk-sh"><span class="dk-st">${esc(title)}</span>${add ? `<button type="button" class="dk-ib"${attrs({ "data-add": id, "aria-label": addLabel, title: addLabel })}>${icon("plus")}</button>` : ""}</div>${body}</section>`,
    ib: ({ icon: k, label = "", pressed, field, cls = "", ...a }) => `<button type="button" class="${cl("dk-ib", field && "dk-field", cls)}"${attrs({ ...a, "aria-label": label, title: label, "aria-pressed": pressed === undefined ? undefined : String(!!pressed) })}>${icon(k)}</button>`,
    btn: ({ label, icon: k, primary, cls = "", ...a }) => `<button type="button" class="${cl("dk-btn", primary && "dk-primary", cls)}"${attrs(a)}>${k ? icon(k) : ""}${esc(label)}</button>`,
    chip: ({ label, icon: k, pressed, ...a }) => `<button type="button" class="dk-chip"${attrs({ ...a, "aria-pressed": pressed === undefined ? undefined : String(!!pressed) })}>${k ? icon(k) : ""}${esc(label)}</button>`,
    check: ({ label, checked, ...a }) => `<label class="dk-check"><input type="checkbox"${attrs({ ...a, checked: !!checked })}>${esc(label)}</label>`,
    link: ({ label, ...a }) => `<button type="button" class="dk-link"${attrs(a)}>${esc(label)}</button>`,
    /** A status line: tone ok | bad | on | (none); html is trusted markup built by the caller. */
    note: (tone, html, indent = true) => `<div class="${cl("dk-note", indent && "dk-indent")}"><span class="${cl("dk-dot", tone && `dk-${tone}`)}"></span><span>${html}</span></div>`,
    banner: (html, tail = "") => `<div class="dk-banner"><span class="dk-grow">${html}</span>${tail}</div>`,
    /** Menu items: {label, k (shortcut), danger, disabled, why, sep, head, icon}. */
    menu: (items) => items.map((it, n) => it.sep ? "<hr>" : it.head ? `<div class="dk-mh">${esc(it.head)}</div>`
      : `<button type="button" class="${cl("dk-mi", it.danger && "dk-danger")}" role="menuitem" data-i="${n}"${it.disabled ? attrs({ "aria-disabled": "true", "data-tooltip": it.why || undefined, "data-side": "right" }) : ""}>${it.icon ? icon(it.icon) : ""}<span class="dk-grow">${esc(it.label)}</span>${it.k ? `<span class="dk-mk">${esc(it.k)}</span>` : ""}</button>`).join(""),
    /** A tree row: depth, twisty state (null: no children), icon markup, name, quiet text. */
    treeRow: ({ depth = 0, open, tw, ic = "", name, text, on, also, root, ...a }) =>
      `<div class="${cl("dk-tr", on && "dk-on", also && "dk-also", root && "dk-root")}" style="--d:${depth}"${attrs(a)}>${open === null || open === undefined ? (root ? "" : '<span class="dk-tw"></span>') : `<button type="button" class="dk-tw"${attrs({ "data-tw": tw, "aria-expanded": String(!!open) })}>${icon("chevRight")}</button>`}${ic}<span class="dk-tn">${esc(name)}</span>${text ? `<span class="dk-tx">${esc(text)}</span>` : ""}</div>`,
    fold: ({ title, open, body, cls = "", ...a }) => `<details class="${cl(cls)}"${attrs({ ...a, open: !!open })}><summary class="dk-fold"><span class="dk-grow">${esc(title)}</span>${icon("chevRight")}</summary>${body}</details>`,
    comment: ({ who, when, text }) => `<div class="dk-cmt"><div class="dk-cmt-h"><b>${esc(who)}</b><span>${esc(when)}</span></div><div class="dk-cmt-t">${esc(text)}</div></div>`,
    /** Place a floating element (menu, popover) at a point inside `host`, kept on screen. */
    place(elx, host, x, y) {
      const rr = host.getBoundingClientRect(), w = elx.offsetWidth, h = elx.offsetHeight;
      elx.style.left = `${Math.max(4, Math.min(x - rr.left, rr.width - w - 4))}px`;
      elx.style.top = `${Math.max(4, Math.min(y - rr.top, rr.height - h - 4))}px`;
    },
  };
})();
