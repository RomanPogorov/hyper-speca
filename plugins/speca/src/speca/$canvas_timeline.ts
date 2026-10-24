// The timeline of this chat's project — or of the chat itself when it has none (kind speca.timeline): every turn from
// the start until now, what it did and changed, newest first. Drawn by web/timeline.ts (GET /speca/s/:id/timeline).
import { html } from "../../web/html.ts";

export const hint = "the timeline of this chat's project (or of this chat when it has no project): every turn from the start until now — what was done, asked, changed (artboards, canvases, files, commits), newest first — args `{}`. Open it when the person wants to see how the work went.";

export default {
  icon: "clock",
  prepare(_ctx: Context, _o: { args: Record<string, any> }) { return { args: {}, title: "Таймлайн" }; },
  async render(_ctx: Context, o: { agentId: string }) {
    return String(html`<div hx-get="/speca/s/${o.agentId}/timeline" hx-trigger="load" hx-swap="outerHTML"><div class="doc"><span class="skel skel-page"></span></div></div>`);
  },
  describe() { return "the timeline of the chat's project or chat (drawn from the log)"; },
};
