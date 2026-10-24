// GET /speca/s/:id/schedules — the line of what the chat has scheduled, above the composer.
// Hyper keeps an agent's wake-ups in its own card (agent/$chatcard_wakeups); this dock stays empty until they are mapped.
import { route } from "../../web/route.ts";
import { chatOf, chatCtx } from "../../web/pages.ts";
import { schedDock } from "../../web/views/chat.ts";

export default route(async (c) => {
  const s = await chatOf(c);
  return schedDock(await chatCtx(c, s), []);
});
