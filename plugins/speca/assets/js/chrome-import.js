// Settings → My computers, inside the Speca app: brings the person's Chrome sign-ins into the app's browser. The app
// does the work on the computer (window.dhDesktop.chrome, speca-desktop's chrome.js); this page only picks the
// profile and shows the counts and the outcome — no cookie ever comes here.
(() => {
  const root = document.getElementById("chr-import");
  const C = window.dhDesktop?.chrome;
  if (!root || root.dataset.ready) return;
  root.dataset.ready = "1";
  if (!C) { root.hidden = true; return; }
  const $ = (n) => root.querySelector(`[data-chr="${n}"]`);
  const bring = $("bring"), source = $("source"), daily = $("daily"), out = $("out"), fix = $("fix");
  const L = JSON.parse(bring.dataset.l || "{}");
  const fill = (s, v) => String(s ?? "").replace(/\{(\w+)\}/g, (_, k) => (v[k] ?? ""));
  const when = (iso) => new Date(iso).toLocaleString(bring.dataset.locale || undefined, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const say = (text, bad) => { out.textContent = text; out.classList.toggle("bad", !!bad); };

  // the Speca extension in their Chrome is connected: the sign-ins come through it (no keychain, no disk access)
  const viaExt = bring.dataset.ext === "1" && !!C.receive;
  const csrf = () => { try { return JSON.parse(document.body.getAttribute("hx-headers") || "{}")["x-csrf"] || ""; } catch { return ""; } };
  const throughExtension = async () => {
    const { url } = await C.receive();
    const r = await fetch("/speca/browser-link/cookies-to", { method: "POST", headers: { "x-csrf": csrf(), "hx-request": "true", "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ url }) });
    if (!r.ok) { const e = await r.json().catch(() => ({})); return { ok: false, error: e.error ?? "ext_failed", message: e.message ?? "" }; }
    return C.received();
  };
  // (through the extension: one press brings them; the daily run is the keychain way's)
  if (viaExt) { source.closest(".field")?.setAttribute("hidden", ""); daily.closest(".check-row")?.setAttribute("hidden", ""); }

  const load = async () => {
    // through the extension nothing of Chrome's folder is read here (no question from macOS)
    const [{ sources, blocked }, st] = await Promise.all([viaExt ? { sources: [], blocked: [] } : C.sources(), C.status()]);
    if (viaExt) { daily.checked = !!st.auto; if (st.last) say(fill(L.last, { ...st.last, when: when(st.last.at) })); return; }
    const opts = sources.map((s) => [s.id, `${s.browserName} · ${s.name}${s.email ? ` · ${s.email}` : ""}`]);
    // macOS keeps Chrome's folder closed until the person allows it: the button still asks, and says what to do
    if (blocked.some((b) => b.browser === "chrome")) opts.unshift(["chrome/Default", "Google Chrome"]);
    source.replaceChildren(...opts.map(([value, textContent]) => Object.assign(document.createElement("option"), { value, textContent })));
    if (!opts.length) { say(L.none); bring.disabled = true; return; }
    // the profile brought last time (if anything came over from it); else the Chrome profile used last
    source.value = (opts.find(([v]) => v === st.last?.source && st.last.cookies > 0) ?? opts.find(([v]) => v.startsWith("chrome/")) ?? opts[0])[0];
    daily.checked = !!st.auto;
    if (st.last) say(fill(L.last, { ...st.last, when: when(st.last.at) }));
  };

  bring.addEventListener("click", async () => {
    if (bring.getAttribute("aria-busy") === "true") return;
    bring.setAttribute("aria-busy", "true"); bring.disabled = true; fix.hidden = true;
    say(viaExt ? L.workingExt : L.working);
    try {
      const r = viaExt ? await throughExtension() : await C.bring(source.value);
      if (r?.ok) say(fill(L.done, r));
      else {
        say(fill(L[`e.${r?.error}`] ?? L["e.read"], { message: r?.message ?? "" }), true);
        fix.hidden = r?.error !== "files";
      }
    } finally { bring.removeAttribute("aria-busy"); bring.disabled = false; }
  });
  daily.addEventListener("change", () => C.auto(daily.checked));
  $("privacy").addEventListener("click", () => C.privacy());
  load().catch((e) => say(String(e?.message ?? e), true));
})();
