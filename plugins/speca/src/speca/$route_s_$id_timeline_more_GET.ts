// GET /speca/s/:id/timeline/more?before=<ms>&day=<yyyy-mm-dd> — an older page of the timeline, and its "Earlier".
import { route } from "../../web/route.ts";
import { chatOf } from "../../web/pages.ts";
import { appShim } from "../../web/hyper.ts";
import { timelineMore } from "../../web/timeline.ts";

export default route(async (c) => {
  const s = await chatOf(c);
  const before = Number(c.url.searchParams.get("before") ?? Date.now());
  return timelineMore(c.h, c.t, s, c.user.tz ?? appShim.config.org.timezone, before, c.url.searchParams.get("day") ?? "");
});
