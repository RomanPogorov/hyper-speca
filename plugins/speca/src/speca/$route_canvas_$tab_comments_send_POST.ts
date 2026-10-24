// POST /speca/canvas/:tab/comments/send — every comment of the person that waits on this tab goes to the agent in
// one message.
import { route } from "../../web/route.ts";
import { me, ownTab, sendToAgent } from "../../web/canvasApi.ts";

export default route(async (c) => {
  const { tab, s } = await ownTab(c);
  const ids = (await c.h.fns.canvas.comments({ itemId: tab.id }))
    .filter((x: any) => x.sentAt == null && (x.author === me(c) || x.author === "user")).map((x: any) => x.id);
  return Response.json({ sent: await sendToAgent(c, s, tab, ids) });
});
