// GET /speca/s/:id/timeline/recent — the newest page of the timeline (redrawn live).
import { route } from "../../web/route.ts";
import { chatOf } from "../../web/pages.ts";
import { appShim } from "../../web/hyper.ts";
import { timelineRecent } from "../../web/timeline.ts";

export default route(async (c) => {
  const s = await chatOf(c);
  return timelineRecent(c.h, c.user.id, c.t, s, c.user.tz ?? appShim.config.org.timezone);
});
