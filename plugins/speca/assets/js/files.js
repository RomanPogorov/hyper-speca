// The "Files" tab of a code project: the folder's tree (search by name), a file with highlighting, and — for the chat's
// owner — editing (@pierre/diffs Editor: selections, undo, find) and saving through the server's code gate. Unsaved
// drafts outlive the canvas being redrawn (kept per chat in this module, the editor's history by its key).
import { File, Editor, preloadHighlighter, getFiletypeFromFileName } from "/speca/assets/vendor/diffs/diffs.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const csrf = () => { try { return JSON.parse(document.body.getAttribute("hx-headers") || "{}")["x-csrf"] || ""; } catch { return ""; } };
const theme = () => (document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light");
/** Per chat: the open file, the open folders, the search, unsaved drafts — across redraws of the canvas. */
const MEM = new Map();

const scan = () => document.querySelectorAll(".pf-view:not([data-init])").forEach(init);
const liveOf = (sid) => document.querySelector(`.pf-live[data-session="${sid}"]`);
// after a redraw the kept view may be asked for another file (opened from the diff or the chat)
document.addEventListener("htmx:afterSettle", () => {
  scan();
  document.querySelectorAll(".pf-view[data-init]").forEach((v) => { const p = liveOf(v.dataset.session)?.dataset.path; if (p && p !== v.dataset.asked) { v.dataset.asked = p; v._pf?.goto(p); } });
});
// the chat's events (the agent at work): delegated, the marker element is replaced on redraws
document.addEventListener("dh-live", (e) => { const t = e.target; if (t?.classList?.contains("pf-live")) document.getElementById(`pf-${t.dataset.session}`)?._pf?.live(); });
new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
scan();

async function init(root) {
  root.dataset.init = "1";
  const sid = root.dataset.session, L = JSON.parse(root.dataset.l || "{}"), I = JSON.parse(root.dataset.icons || "{}");
  const m = MEM.get(sid) ?? { path: "", open: new Set(), q: "", drafts: new Map(), gen: new Map(), dirs: new Set() };
  MEM.set(sid, m);
  const fmt = (s, o) => String(s).replace(/\{(\w+)\}/g, (_, k) => o[k] ?? "");
  const btn = (act, icon, tip, extra = "") => `<button type="button" class="btn" data-variant="ghost" data-size="icon-xs" data-act="${act}" aria-label="${esc(tip)}" data-tooltip="${esc(tip)}" data-side="bottom" ${extra}>${I[icon] ?? ""}</button>`;
  // the file's text as a part of its own: a string field of a multipart form gets its line breaks turned into CRLF
  const post = (data) => fetch(`/speca/s/${sid}/files/op`, { method: "POST", headers: { "x-csrf": csrf(), "hx-request": "true" }, body: Object.entries(data).reduce((fd, [k, v]) => (k === "content" ? fd.append(k, new Blob([v], { type: "text/plain" }), "content") : fd.append(k, v), fd), new FormData()) });

  root.innerHTML = `<div class="pf-side"><div class="pf-tools"><label class="pf-search">${I.search ?? ""}<input type="search" class="input" placeholder="${esc(L.search)}" aria-label="${esc(L.search)}" value="${esc(m.q)}"></label><span class="pf-new"></span></div><div class="pf-tree" role="tree"><div class="chg-empty">${esc(L.loading)}</div></div></div>
    <div class="pf-main"><div class="pf-head"></div><div class="pf-bar" hidden></div><div class="pf-body"><div class="chg-empty">${esc(L.pick)}</div></div></div>`;
  const tree = root.querySelector(".pf-tree"), head = root.querySelector(".pf-head"), bar = root.querySelector(".pf-bar"), body = root.querySelector(".pf-body");
  let data = { files: [], changed: {}, canEdit: false, truncated: false };
  let cur = null; // { path, version, base, file, editor, detach }

  async function load() {
    const r = await fetch(`/speca/s/${sid}/files`).catch(() => null);
    if (r?.ok) data = await r.json();
    root.querySelector(".pf-new").innerHTML = data.canEdit ? btn("new-file", "plus", L.newFile) + btn("new-folder", "folderPlus", L.newFolder) : "";
    drawTree();
  }

  // ── the tree ──
  function build() {
    const top = { name: "", path: "", dirs: new Map(), files: [] };
    const dirOf = (path) => { let at = top; let p = ""; for (const part of path.split("/")) { p = p ? `${p}/${part}` : part; if (!at.dirs.has(part)) at.dirs.set(part, { name: part, path: p, dirs: new Map(), files: [] }); at = at.dirs.get(part); } return at; };
    for (const f of data.files) { const i = f.lastIndexOf("/"); (i < 0 ? top : dirOf(f.slice(0, i))).files.push(f); }
    for (const d of m.dirs) dirOf(d);
    return top;
  }
  const changedIn = (dir) => Object.keys(data.changed).some((p) => p.startsWith(dir + "/"));
  const badge = (p) => (data.changed[p] ? `<span class="chg-st st-${data.changed[p]}" title="${esc(L.st?.[data.changed[p]] ?? "")}">${data.changed[p]}</span>` : "");
  const fileRow = (f, depth, label) => `<button type="button" class="pf-row${cur?.path === f ? " on" : ""}" role="treeitem" data-f="${esc(f)}" style="--d:${depth}" title="${esc(f)}">${I.file ?? ""}<span class="chg-name">${label ?? esc(f.split("/").pop())}</span>${m.drafts.has(f) ? `<i class="pf-dirty" title="${esc(L.unsaved)}"></i>` : ""}${badge(f)}</button>`;
  function drawTree() {
    const q = m.q.trim().toLowerCase();
    if (q) {
      const hits = data.files.filter((f) => f.toLowerCase().includes(q));
      hits.sort((a, b) => Number(!a.split("/").pop().toLowerCase().includes(q)) - Number(!b.split("/").pop().toLowerCase().includes(q)) || a.length - b.length);
      tree.innerHTML = hits.length ? hits.slice(0, 300).map((f) => { const i = f.lastIndexOf("/"); return fileRow(f, 0, `${esc(f.slice(i + 1))}${i > 0 ? ` <small class="muted">${esc(f.slice(0, i))}</small>` : ""}`); }).join("") : `<div class="chg-empty small">${esc(L.none)}</div>`;
      return;
    }
    const rows = [];
    const walk = (dir, depth) => {
      for (const d of [...dir.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))) {
        const open = m.open.has(d.path);
        rows.push(`<button type="button" class="pf-row pf-dir" role="treeitem" aria-expanded="${open}" data-d="${esc(d.path)}" style="--d:${depth}">${I.chevRight ?? ""}${I.folder ?? ""}<span class="chg-name">${esc(d.name)}</span>${changedIn(d.path) ? `<i class="pf-mark"></i>` : ""}</button>`);
        if (open) walk(d, depth + 1);
      }
      for (const f of dir.files.sort((a, b) => a.localeCompare(b))) rows.push(fileRow(f, depth));
    };
    walk(build(), 0);
    tree.innerHTML = rows.join("") + (data.truncated ? `<div class="chg-empty small">${esc(fmt(L.more, { n: data.files.length }))}</div>` : "");
  }
  tree.addEventListener("click", (e) => {
    const r = e.target.closest(".pf-row"); if (!r) return;
    if (r.dataset.d !== undefined) { const p = r.dataset.d; m.open.has(p) ? m.open.delete(p) : m.open.add(p); drawTree(); return; }
    openFile(r.dataset.f);
  });
  root.querySelector(".pf-search input").addEventListener("input", (e) => { m.q = e.target.value; drawTree(); });

  // ── one file ──
  function reveal(path) { const parts = path.split("/"); for (let i = 1; i < parts.length; i++) m.open.add(parts.slice(0, i).join("/")); }
  function drawHead() {
    if (!cur) { head.innerHTML = ""; return; }
    const parts = cur.path.split("/");
    const dirty = m.drafts.has(cur.path);
    head.innerHTML = `<button type="button" class="btn pf-back" data-variant="ghost" data-size="icon-xs" data-act="to-tree" aria-label="${esc(L.back)}">${I.chevLeft ?? ""}</button><span class="pf-path" title="${esc(cur.path)}">${parts.map((p, i) => `<span${i === parts.length - 1 ? ' class="last"' : ""}>${esc(p)}</span>`).join('<i class="pf-sep">/</i>')}</span>${badge(cur.path)}
      <span class="grow"></span>
      ${!data.canEdit ? `<span class="pf-ro">${esc(L.readonly)}</span>` : ""}
      ${btn("to-chat", "at", L.toChat)}${btn("copy", "copy", L.copyPath)}${data.changed[cur.path] ? btn("diff", "fileDiff", L.showDiff) : ""}
      <a class="btn" data-variant="ghost" data-size="icon-xs" href="/speca/s/${sid}/files/raw?path=${encodeURIComponent(cur.path)}&download=1" aria-label="${esc(L.download)}" data-tooltip="${esc(L.download)}" data-side="bottom">${I.download ?? ""}</a>
      ${data.canEdit ? btn("rename", "pencil", L.rename) + btn("delete", "trash", L.del) : ""}
      ${data.canEdit && cur.kind === "text" ? `<button type="button" class="btn" data-size="sm" data-act="save"${dirty ? "" : " disabled"}>${esc(L.save)}</button>` : ""}`;
  }
  function close() { try { cur?.detach?.(); } catch {} try { cur?.file?.cleanUp?.(); } catch {} cur = null; }
  async function openFile(path, o = {}) {
    if (!path) return;
    close();
    m.path = path; reveal(path);
    root.dataset.pane = "file";   // a phone shows the tree or the file, not both
    cur = { path, kind: "loading" };
    drawTree(); drawHead(); bar.hidden = true;
    body.innerHTML = `<div class="chg-empty">${esc(L.loading)}</div>`;
    const r = await fetch(`/speca/s/${sid}/files/read?path=${encodeURIComponent(path)}`).catch(() => null);
    if (cur?.path !== path) return;
    const v = r ? await r.json().catch(() => null) : null;
    if (!r?.ok || !v) { cur.kind = "missing"; drawHead(); body.innerHTML = `<div class="chg-empty">${esc(v?.message ?? L.error)}</div>`; return; }
    Object.assign(cur, { kind: v.kind, version: v.version });
    drawHead();
    if (v.kind === "image") { body.innerHTML = `<div class="pf-img"><img src="/speca/s/${sid}/files/raw?path=${encodeURIComponent(path)}&v=${encodeURIComponent(v.version)}" alt="${esc(path)}"></div>`; return; }
    if (v.kind !== "text") { body.innerHTML = `<div class="chg-empty">${esc(v.kind === "large" ? L.large : L.binary)}</div>`; return; }
    cur.base = v.content; cur.crlf = /\r\n/.test(v.content);
    const draft = m.drafts.get(path);
    // a draft goes on where it was left; else a fresh history (the file may have changed meanwhile)
    if (!draft || o.fresh) { m.drafts.delete(path); m.gen.set(path, (m.gen.get(path) ?? 0) + 1); }
    const key = `${sid}:${path}:${m.gen.get(path) ?? 0}`;
    // the language's highlighting first: when it arrives later the file is drawn again from the original text, and
    // what was typed in the meantime is lost
    try { await preloadHighlighter({ themes: ["pierre-dark", "pierre-light"], langs: [getFiletypeFromFileName(path)] }); } catch {}
    if (cur?.path !== path) return;
    body.innerHTML = `<div class="pf-code"></div>`;
    cur.file = new File({ theme: { dark: "pierre-dark", light: "pierre-light" }, themeType: theme(), overflow: "scroll", disableFileHeader: true });
    cur.file.render({ file: { name: path, contents: draft && !o.fresh ? draft.text : v.content }, containerWrapper: body.querySelector(".pf-code") });
    if (data.canEdit) {
      cur.editor = new Editor("file", { onChange: () => markDirty() }, key);
      cur.detach = cur.editor.edit(cur.file);
      // the caret in the file at once (the editor finishes setting up on its first focus; keys pressed before are lost)
      try { cur.editor.focus({ lineNumber: 1 }); } catch {}
    }
    if (draft && !o.fresh && draft.version !== v.version) conflict();
  }
  // the editor's text in the file's own line endings
  const textOf = () => { const t = cur.editor.getText(); return cur.crlf ? t.replace(/\r?\n/g, "\r\n") : t.replace(/\r\n/g, "\n"); };
  function markDirty() {
    if (!cur?.editor) return;
    const text = textOf();
    const was = m.drafts.has(cur.path);
    if (text === cur.base) m.drafts.delete(cur.path); else m.drafts.set(cur.path, { text, version: m.drafts.get(cur.path)?.version ?? cur.version });
    if (was !== m.drafts.has(cur.path)) { drawHead(); drawTree(); }
  }
  function conflict() {
    bar.hidden = false;
    bar.innerHTML = `<span>${esc(L.changed)}</span><span class="grow"></span><button type="button" class="btn" data-variant="outline" data-size="sm" data-act="reload">${esc(L.reload)}</button><button type="button" class="btn" data-variant="outline" data-size="sm" data-act="overwrite">${esc(L.overwrite)}</button>`;
  }
  async function save(force) {
    if (!cur?.editor || (!force && !m.drafts.has(cur.path))) return;
    const path = cur.path, text = textOf();
    let version = m.drafts.get(path)?.version ?? cur.version;
    if (force) { const v = await fetch(`/speca/s/${sid}/files/read?path=${encodeURIComponent(path)}`).then((r) => r.json()).catch(() => null); version = v?.version ?? ""; }
    const sb = head.querySelector('[data-act="save"]'); if (sb) { sb.disabled = true; sb.textContent = L.saving; }
    const r = await post({ op: "save", path, content: text, version }).catch(() => null);
    const res = r ? await r.json().catch(() => ({})) : {};
    if (r?.status === 409) { conflict(); drawHead(); return; }
    if (!r?.ok) { window.dhToast?.(L.error, res.message ?? "", "error"); drawHead(); return; }
    m.drafts.delete(path);
    if (cur?.path === path) { cur.base = text; cur.version = res.version; bar.hidden = true; }
    window.dhToast?.(L.saved, path);
    await load(); drawHead();
  }
  function mention() {
    if (!cur) return;
    const cin = document.getElementById("cin"); if (!cin) return;
    // the selected lines if any: "@path:12-20"
    let ref = cur.path;
    try { const sel = cur.editor?.getViewState()?.selections?.[0]; if (sel && (sel.start.line !== sel.end.line || sel.start.character !== sel.end.character)) { const a = Math.min(sel.start.line, sel.end.line) + 1, b = Math.max(sel.start.line, sel.end.line) + 1; ref += a === b ? `:${a}` : `:${a}-${b}`; } } catch {}
    if (window.dhCompose) { window.dhCompose(`@${ref}`, { at: "caret" }); return; }
    const at = cin.selectionStart ?? cin.value.length, pre = cin.value.slice(0, at), post = cin.value.slice(at);
    const ins = `${pre && !/\s$/.test(pre) ? " " : ""}@${ref} `;
    cin.value = pre + ins + post; cin.focus(); cin.selectionStart = cin.selectionEnd = (pre + ins).length;
    cin.dispatchEvent(new Event("input", { bubbles: true }));
  }
  async function op(data, then) {
    const r = await post(data).catch(() => null);
    const res = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) { window.dhToast?.(L.error, res.message ?? "", "error"); return false; }
    await then?.(); await load(); return true;
  }
  // a name typed in place: a row at the top of the tree (new) or the path in the head (rename)
  function ask(where, value, done) {
    const f = document.createElement("form"); f.className = "pf-ask";
    f.innerHTML = `<input class="input" value="${esc(value)}" aria-label="${esc(L.newName)}" placeholder="${esc(L.newName)}">`;
    where.prepend(f);
    const i = f.querySelector("input"); i.focus(); i.select();
    let gone = false; const end = () => { if (!gone) { gone = true; f.remove(); } };
    f.onsubmit = async (e) => { e.preventDefault(); const v = i.value.trim().replace(/^\/+/, ""); end(); if (v && v !== value) await done(v); };
    i.onkeydown = (e) => { if (e.key === "Escape") end(); };
    i.onblur = () => setTimeout(end, 150);
  }
  const folderHere = () => (cur?.path?.includes("/") ? cur.path.slice(0, cur.path.lastIndexOf("/") + 1) : "");
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]"); if (!b || !root.contains(b)) return;
    const a = b.dataset.act;
    if (a === "save") save(false);
    else if (a === "overwrite") save(true);
    else if (a === "reload") { bar.hidden = true; m.drafts.delete(cur.path); openFile(cur.path, { fresh: true }); }
    else if (a === "to-tree") root.dataset.pane = "tree";
    else if (a === "to-chat") mention();
    else if (a === "copy") { await navigator.clipboard?.writeText(cur.path).catch(() => {}); window.dhToast?.(L.copied, cur.path); }
    else if (a === "diff") fetch(`/speca/s/${sid}/changes/open`, { method: "POST", headers: { "x-csrf": csrf(), "hx-request": "true" }, body: new URLSearchParams({ file: cur.path }) });
    else if (a === "new-file") ask(tree, folderHere(), (p) => op({ op: "create", path: p }, () => { m.path = p; reveal(p); }).then((ok) => ok && openFile(p)));
    else if (a === "new-folder") ask(tree, folderHere(), (p) => op({ op: "create", path: p, folder: "1" }, () => { m.dirs.add(p); m.open.add(p); reveal(p + "/speca/x"); }));
    else if (a === "rename") { const from = cur.path; ask(head, from, (p) => op({ op: "rename", path: from, to: p }, () => { const d = m.drafts.get(from); m.drafts.delete(from); if (d) m.drafts.set(p, d); }).then((ok) => ok && openFile(p))); }
    else if (a === "delete") {
      if (!confirm(fmt(L.delAsk, { name: cur.path }))) return;
      const p = cur.path;
      if (await op({ op: "delete", path: p }, () => { m.drafts.delete(p); })) { close(); m.path = ""; root.dataset.pane = "tree"; drawHead(); body.innerHTML = `<div class="chg-empty">${esc(L.pick)}</div>`; drawTree(); }
    }
  });
  root.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && cur?.editor) { e.preventDefault(); save(false); } });

  // the agent's work shows here as it happens: the list, and the open file when it has no unsaved edits
  let lastLive = 0, liveT = null;
  const onLive = () => {
    clearTimeout(liveT);
    liveT = setTimeout(async () => {
      lastLive = Date.now();
      await load();
      if (!cur || cur.kind === "loading") return;
      const v = await fetch(`/speca/s/${sid}/files/read?path=${encodeURIComponent(cur.path)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (!v || !cur || v.version === cur.version) return;
      if (m.drafts.has(cur.path)) conflict(); else openFile(cur.path, { fresh: true });
    }, Math.max(300, 2000 - (Date.now() - lastLive)));
  };
  root._pf = { text: () => cur?.editor?.getText(), live: onLive, goto: (p) => { if (p !== cur?.path) openFile(p); } };

  await load();
  const asked = liveOf(sid)?.dataset.path || "";
  root.dataset.asked = asked;
  const want = asked || m.path;
  if (want) openFile(want);
}
