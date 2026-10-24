// POST /speca/canvas/:tab/ask-diff — "what changed?" goes to the chat as the person's message; the agent reads both
// versions (canvas.version) and answers there.
import { route } from "../../web/route.ts";
import { say } from "../../web/actions.ts";
import { ownTab } from "../../web/canvasApi.ts";
import { withContext } from "../../web/hyper.ts";

export default route(async (c) => {
  const { tab, s } = await ownTab(c);
  const f = await c.form();
  const label = (x: string) => (/^v\d+$/.test(x) ? x : c.t("canvas.draft").toLowerCase());
  const text = c.t("canvas.askDiffText", { from: label(f.from ?? ""), to: label(f.to ?? ""), title: tab.title });
  await say(c, s, withContext(text, [`canvas tab «${tab.title}» (tab ${tab.id}, ${tab.kind})`], "Read both with canvas.version (the draft: no v) and answer in the chat."), `ask-diff:${tab.id}:${Date.now()}`);
  return null;
});
