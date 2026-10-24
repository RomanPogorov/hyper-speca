# Design canvas kit

Everything the design canvas draws for itself is built from this kit: the properties panel, the menus, the bars
over the stage, popovers, comments, the layers tree. It sits on top of the system (docs/DESIGN.md) and uses only its
tokens. A new control is a new builder here plus its styles. Never write one-off markup in `panel.js` or `dcv.js`.

- Styles: `assets/dck.css`.
- Builders: `assets/dck.js` (`window.dck`). Each one returns an HTML string.
- Live catalogue: `/p/design-canvas/kit` (`kit.route.ts`, `assets/kit.js`).

## Tokens

They are set on `.dcv` and `.dk-scope`.

| Token | Value | What it is |
|---|---|---|
| `--dk-h` | 26px | Height of every control. |
| `--dk-h-in` | 22px | A control inside another control: a segment, an icon. |
| `--dk-r` / `--dk-r-in` | `--r-sm` / 5px | Control radius / inner radius. |
| `--dk-pad` | `--s-2` | Padding on both sides of a control. A select keeps this padding after its chevron. |
| `--dk-chev` | 12px | Size of the select chevron. |
| `--dk-gap` | `--s-1` | Gap between the controls of one row. |
| `--dk-label` | 104px | Width of the label column. |
| `--dk-fs` | `--fs-sm` | Font size of controls. |
| `--dk-sec-x` | `--s-3` | Section inset. |
| `--dk-peer-0…5` | oklch hues | One colour per person on a canvas. No orange or amber. |

## Components

| Builder | Class | Use |
|---|---|---|
| `input({value, placeholder, center, inh, …attrs})` | `.dk-input` | A text or number field. `inh`: the value shown is inherited, not set. |
| `textarea({…})` | `.dk-input` | Comments and replies. |
| `select({options, value, inh, …attrs})` | `.dk-select > select` | A native list with our chevron and padding after it. A value not in the list becomes its own option. |
| `seg({options, value, inh, data})` | `.dk-seg` | 2–3 short choices: direction, alignment. Use `select` for longer words. |
| `swatch({color, label})`, `color({swatch, field, inh})` | `.dk-sw`, `.dk-color` | A colour, alone or next to its field. |
| `colorRow({swatch, field, count, target})` | `.dk-crow` | One colour in a list (Selection colors): how many elements use it, and an action. |
| `pair(a, b, wide)`, `quad(cells, caps)`, `split(a, b)`, `withButton(c, b)` | `.dk-pair`, `.dk-quad`, `.dk-split`, `.dk-with` | Groups of controls. `split` puts a wide part next to a part that takes only the room it needs. `withButton` puts a field next to a square button. |
| `row(label, control, {scrub, prop, top})`, `sub(inner)` | `.dk-row`, `.dk-sub` | A labelled row. `scrub`: drag the label to change the value. `sub` is an indented row with no label. |
| `section({id, title, add, body})` | `.dk-sec` | A titled group. `+` shows the rows kept back. |
| `ib({icon, label, pressed, field})`, `btn({label, icon, primary})`, `chip({label, icon, pressed})`, `link({label})`, `check({label, checked})` | `.dk-ib`, `.dk-btn`, `.dk-chip`, `.dk-link`, `.dk-check` | Buttons, a toggle chip, a link, a checkbox. |
| `note(tone, html, indent)`, `banner(html)` | `.dk-note`, `.dk-banner` | A status line (tone `ok`, `bad`, `on`); a strip at the top of the panel. |
| `menu(items)` | `.dk-menu .dk-mi` | Items: `{label, k, icon, danger, disabled, why, sep, head}`. A disabled item stays visible and says why. |
| `treeRow({depth, open, tw, ic, name, text, on, also, root})` | `.dk-tr` | Layers. The twisty is a padded chevron. |
| `fold({title, open, body})` | `.dk-fold` | A section that folds. |
| `comment({who, when, text})` | `.dk-cmt` | One entry of a thread. |
| — | `.dk-pop`, `.dk-pop-h`, `.dk-pop-f` | A floating card: header, footer. |
| — | `.dk-bar`, `.dk-txt`, `.dk-vsep`, `.dk-badge` | A floating bar over the stage: selection, zoom. |
| `place(el, host, x, y)` | — | Positions a menu or popover at a point and keeps it on screen. |

## Rules

- **One height.** Every field, select and button is `--dk-h`.
- **Chevrons get room.** A chevron always has `--dk-pad` after it and is never flush with an edge.
- **No truncated labels.** If labels do not fit a segmented control, use a `select`. If captions do not fit under a
  quad, use labelled rows or glyph captions with full names in `title` and `aria-label`.
- **Inherited and mixed values are placeholders, not values.** A mixed value shows "Mixed" / «Разные».
- **Every string comes from `lib/strings.ts`** (en and ru): `C` for the scripts, `L` for the rendered page.
