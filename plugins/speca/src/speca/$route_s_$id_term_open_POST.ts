// POST /speca/s/:id/term/open {server?} — the chat's terminal tab, opened (or brought up): the "+" menu and the ▶ of
// a shell block in the chat (assets/js/app.js runInTerminal).
import { route } from "../../web/route.ts";
import { chatOf } from "../../web/pages.ts";
import { tabsOf } from "../../web/canvas.ts";

export default route(async (c) => {
  const s = await chatOf(c);
  const f = await c.form();
  const server = String(f.server ?? "").slice(0, 60);
  const open = (await tabsOf(c, s.id)).find((x: any) => x.kind === "speca.terminal" && !x.closed && (!server || (x.state?.server ?? x.args?.server) === server));
  const fns = c.h.fns as any;
  const tab = open ?? (await fns.canvas.show({ agentId: s.id, kind: "speca.terminal", args: server ? { server } : {} }));
  await fns.canvas.update({ agentId: s.id, open: true, activeItemId: tab.id });
  await fns.canvas.notify({ agentId: s.id });
  return null;
});
