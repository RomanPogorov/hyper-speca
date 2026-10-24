// The "Changes" tab: what the agent changed in a code project's folder, per turn or for the whole chat, as diffs
// (@pierre/diffs, bundled locally). Files on the left, their diffs stacked on the right, each drawn when it scrolls
// into view. Split or unified, wrapping — remembered.
import { FileDiff } from "/speca/assets/vendor/diffs/diffs.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const scan = () => document.querySelectorAll(".chg-view:not([data-init])").forEach(init);
document.addEventListener("htmx:afterSettle", scan);
new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
scan();

async function init(root) {
  root.dataset.init = "1";
  const sid = root.dataset.session, L = JSON.parse(root.dataset.l || "{}");
  let layout = localStorage.getItem("dh.chg.layout") || (matchMedia("(max-width: 820px)").matches ? "unified" : "split"), wrap = localStorage.getItem("dh.chg.wrap") === "1";
  let scope = root.dataset.turn || "all";
  root.innerHTML = `<div class="chg-empty">${esc(L.loading)}</div>`;
  const csrf = () => { try { return JSON.parse(document.body.getAttribute("hx-headers") || "{}")["x-csrf"] || ""; } catch { return ""; } };
  const fmt = (s, o) => String(s).replace(/\{(\w+)\}/g, (_, k) => o[k] ?? "");
  let data = { turns: [], all: [], canRevert: false };
  const load = async () => { data = await fetch(`/speca/s/${sid}/changes`).then((r) => r.json()).catch(() => ({ turns: [], all: [] })); };
  await load();
  if (!data.all.length) { root.innerHTML = `<div class="chg-empty">${esc(L.none)}</div>`; return; }
  // a revert: the server's answer is a toast (the HX-Trigger header), then the view is drawn again
  async function revert(body) {
    const r = await fetch(`/speca/s/${sid}/changes/revert`, { method: "POST", headers: { "x-csrf": csrf(), "hx-request": "true" }, body: new URLSearchParams(body) }).catch(() => null);
    let trig = {}; try { trig = JSON.parse(r?.headers.get("hx-trigger") || "{}"); } catch {}
    const tt = trig["dh-toast"]; if (tt) window.dhToast?.(tt.title, tt.description, tt.category);
    await load(); draw();
  }
  // reverted from the chat's card: the same
  document.addEventListener("dh-chg-reload", async () => { if (!root.isConnected) return; await load(); draw(); });
  const when = (iso) => new Date(iso).toLocaleTimeString(document.documentElement.lang || [], { hour: "2-digit", minute: "2-digit" });
  const diffs = new Map();
  let revertFile = () => {};
  const theme = () => (document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light");
  function draw() {
    const files = scope === "all" ? data.all : (data.turns.find((t) => t.turnId === scope)?.files ?? []);
    const add = files.reduce((n, f) => n + f.add, 0), del = files.reduce((n, f) => n + f.del, 0);
    root.innerHTML = `<div class="chg-bar">
        <span class="dk-select"><select class="chg-scope" aria-label="${esc(L.turn)}"><option value="all">${esc(L.all)}</option>${data.turns.map((t) => `<option value="${esc(t.turnId)}"${t.turnId === scope ? " selected" : ""}>${esc(t.author ? L.byHand : L.turn)} ${when(t.at)} · +${t.added} −${t.removed}</option>`).join("")}</select></span>
        <span class="chg-n"><i class="add">+${add}</i><i class="del">−${del}</i></span><span class="grow"></span>
        <div class="seg chg-layout"><button type="button" data-l="split" aria-pressed="${layout === "split"}">${esc(L.split)}</button><button type="button" data-l="unified" aria-pressed="${layout === "unified"}">${esc(L.unified)}</button></div>
        <label class="chg-wrap"><input type="checkbox" class="checkbox"${wrap ? " checked" : ""}> ${esc(L.wrap)}</label>
        ${data.canRevert && files.length ? `<button type="button" class="btn chg-rv-all" data-variant="ghost" data-size="icon-sm" aria-label="${esc(L.revertScope)}" data-tooltip="${esc(L.revertScope)}" data-side="bottom" data-align="end">${root.dataset.undo ?? ""}</button>` : ""}
      </div>
      <div class="chg-body"><nav class="chg-list" aria-label="${esc(L.files)}">${files.map((f, i) => `<button type="button" class="chg-f" data-i="${i}" title="${esc(f.path)}"><span class="chg-st st-${f.status}">${f.status}</span><span class="chg-name">${esc(f.path)}</span><span class="chg-n"><i class="add">+${f.add}</i><i class="del">−${f.del}</i></span></button>`).join("")}</nav>
      <div class="chg-diffs">${files.map((f, i) => `<section class="chg-file" data-i="${i}" data-path="${esc(f.path)}"><div class="chg-slot"></div></section>`).join("")}</div></div>`;
    root.querySelector(".chg-scope").onchange = (e) => { scope = e.target.value; draw(); };
    root.querySelectorAll(".chg-layout button").forEach((b) => (b.onclick = () => { layout = b.dataset.l; localStorage.setItem("dh.chg.layout", layout); draw(); }));
    root.querySelector(".chg-wrap input").onchange = (e) => { wrap = e.target.checked; localStorage.setItem("dh.chg.wrap", wrap ? "1" : ""); draw(); };
    const list = root.querySelector(".chg-diffs");
    const turnOf = () => (scope === "all" ? {} : { turn: scope });
    root.querySelector(".chg-rv-all")?.addEventListener("click", () => { if (confirm(fmt(L.revertAllAsk, { n: files.length }))) revert(turnOf()); });
    revertFile = (f) => { if (confirm(fmt(L.revertAsk, { name: f.path }))) revert({ ...turnOf(), file: f.path }); };
    root.querySelectorAll(".chg-list .chg-f").forEach((b) => (b.onclick = () => list.querySelector(`.chg-file[data-i="${b.dataset.i}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" })));
    // each file's diff when it comes into view
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); show(e.target, files[Number(e.target.dataset.i)]); } }), { root: list, rootMargin: "600px" });
    list.querySelectorAll(".chg-file").forEach((el) => io.observe(el));
    const want = root.dataset.file;
    if (want) { root.dataset.file = ""; const i = files.findIndex((f) => f.path === want); if (i >= 0) setTimeout(() => list.querySelector(`.chg-file[data-i="${i}"]`)?.scrollIntoView({ block: "start" }), 50); }
  }
  async function show(el, f) {
    const slot = el.querySelector(".chg-slot");
    const v = await fetch(`/speca/s/${sid}/changes/file?path=${encodeURIComponent(f.path)}${scope === "all" ? "" : `&turn=${encodeURIComponent(scope)}`}`).then((r) => r.json()).catch(() => null);
    if (!v || v.before === false || v.after === false) { slot.innerHTML = `<div class="chg-empty small">${esc(f.path)} · ${esc(L.binary)}</div>`; return; }
    // the file's own revert, in the diff's header
    const rv = () => {
      if (!data.canRevert) return null;
      const b = document.createElement("button");
      b.type = "button"; b.className = "btn chg-rv"; b.dataset.variant = "ghost"; b.dataset.size = "icon-sm"; b.dataset.side = "left";
      b.setAttribute("aria-label", L.revertFile); b.dataset.tooltip = L.revertFile; b.innerHTML = root.dataset.undo ?? "";
      b.onclick = () => revertFile(f);
      return b;
    };
    const d = new FileDiff({ theme: { dark: "pierre-dark", light: "pierre-light" }, themeType: theme(), diffStyle: layout, overflow: wrap ? "wrap" : "scroll", renderHeaderMetadata: rv });
    d.render({ oldFile: { name: f.from || f.path, contents: v.before ?? "" }, newFile: { name: f.path, contents: v.after ?? "" }, containerWrapper: slot });
    diffs.set(el, d);
  }
  draw();
}
