// POST /speca/canvas/comments/:id/send — one waiting comment goes to the agent now.
import { route } from "../../web/route.ts";
import { commentOf, sendToAgent } from "../../web/canvasApi.ts";

export default route(async (c) => {
  const { cm, tab, s } = await commentOf(c);
  await sendToAgent(c, s, tab, [cm.id]);
  return null;
});
