// POST /speca/canvas/:tab/prototype {dir?} — Speca's prototype buttons. On a design: "Build prototype" (none yet),
// "Update prototype" (the design changed since), "Bring from prototype" (dir=back: the prototype changed since); on a
// prototype the same two, for its design. Asked of the agent as the person, with how to do it; the tabs say "the
// agent is on it" until its answer ends.
import { route, toast } from "../../web/route.ts";
import { say } from "../../web/actions.ts";
import { ownTab } from "../../web/canvasApi.ts";
import { withContext } from "../../web/hyper.ts";
import { builtFrom, DESIGN_KINDS, sourceOf, startSync } from "../../web/proto.ts";

export default route(async (c) => {
  const { tab, s } = await ownTab(c);
  const f = await c.form();
  // from the prototype: its design is the one acted on
  const up = DESIGN_KINDS.has(tab.kind) ? null : await sourceOf(c.h as any, tab as any);
  const design = up ? up.source : tab;
  if (!DESIGN_KINDS.has(design.kind)) return new Response("not a design", { status: 400 });
  const built = up ? up : (await builtFrom(c.h as any, design.id))[0] ?? null;
  const back = f.dir === "back" && !!built;
  await startSync(c.h as any, built ? built.built as any : design as any, back ? "back" : built ? "forward" : "build");
  const d = design.id, p = built?.built.id;
  const how = back
    ? `The prototype ${p} changed since it was last in step with the design canvas ${d}. See exactly what changed with speca.protoChanges {itemId: ${p}}; apply what of it is design (screens, copy, styles, new states or screens) to the design's artboards with speca.designRead / speca.designEdit (or speca.designWrite for a new screen); leave out what is only prototype logic. Then speca.protoSynced {itemId: ${p}}. Do not change the prototype.`
    : built
    ? `Update the html tab ${p} (built from the design canvas ${d}) to match the design. See what changed in the design with speca.protoChanges {itemId: ${d}}; bring that over with canvas.edit (or canvas.write), then speca.protoSynced {itemId: ${p}}${built.ahead ? ". The prototype was changed too since the last sync: keep its own changes, apply only what changed in the design" : ""}. Do not change the design canvas.`
    : `Build the prototype as a NEW html canvas tab: canvas.show {kind: "html", args: {html}, title} and right away speca.protoLink {itemId: <the new tab>, from: ${d}} — one self-contained page with every screen of the design (same look, same copy), working navigation and controls (screens switch in place; forms, tabs, inputs behave), a small switcher of states if the design has them. Not links on the design canvas, and do not change the design canvas. Build it in steps the person watches, not in one huge call: within the first minute open the shell (the app frame, the shared styles, the navigation, the first screen; every other screen a placeholder that names it), then fill the screens one per canvas.edit in the flow's order (speca.designRead each artboard when you get to it), then wire the controls, try the main flow and finish with speca.protoSynced {itemId: <the prototype>}.`;
  const text = back ? c.t("proto.askBack", { title: built!.built.title }) : built ? c.t("proto.askUpdate", { title: built.built.title }) : c.t("proto.askBuild");
  const ctxLines = [`design canvas «${design.title}» (tab ${d}, ${design.kind})`, ...(built ? [`prototype «${built.built.title}» (tab ${p}, html)`] : [])];
  await say(c, s, withContext(text, ctxLines, how), `prototype:${d}:${Math.floor(Date.now() / 5000)}`);
  await c.h.fns.canvas.notify({ agentId: s.id }).catch(() => {});
  return toast(c.t("proto.asked"));
});
