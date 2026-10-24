// GET /speca/s/:id/timeline — the timeline of the chat's project (or of the chat): the whole canvas.
import { route } from "../../web/route.ts";
import { chatOf } from "../../web/pages.ts";
import { appShim } from "../../web/hyper.ts";
import { timelineHtml } from "../../web/timeline.ts";

export default route(async (c) => {
  const s = await chatOf(c);
  return timelineHtml(c.h, c.user.id, c.t, s, c.user.tz ?? appShim.config.org.timezone);
});
