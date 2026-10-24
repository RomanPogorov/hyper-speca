// POST /speca/s/:id/board/open {app} — Speca's Whiteboards and Browser from the "+" menu: Excalidraw is Hyper's own
// board (excalidraw.board — the agent reads and redraws it), tldraw is tldraw.com in the shared live browser (as Speca
// opens both, in its browser), `browser` is the live browser on its last tab.
import { route } from "../../web/route.ts";
import { chatOf } from "../../web/pages.ts";

export default route(async (c) => {
  const s = await chatOf(c);
  const f = await c.form();
  const app = String(f.app ?? "");
  const fns = c.h.fns as any;
  let tab: any;
  // the live browser shows Hyper's own Chrome: start it when it is not up yet (as every browser.* function does)
  if (app === "tldraw" || app === "browser") await fns.chrome.ensure({}).catch((e: any) => { throw new Error(`${c.t("canvas.browserDown")} (${String(e?.message ?? e).slice(0, 160)})`); });
  if (app === "excalidraw") {
    const name = `board-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
    tab = await fns.canvas.show({ agentId: s.id, kind: "excalidraw.board", args: { name } });
  } else if (app === "tldraw") {
    tab = await fns.canvas.show({ agentId: s.id, kind: "browser.live", args: { url: "https://www.tldraw.com" }, title: "tldraw" });
  } else if (app === "browser") {
    tab = await fns.canvas.show({ agentId: s.id, kind: "browser.live", args: {}, title: c.t("canvas.browser") });
  } else return null;
  await fns.canvas.update({ agentId: s.id, open: true, activeItemId: tab.id });
  await fns.canvas.notify({ agentId: s.id });
  return null;
});
