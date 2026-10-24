// The chat's subagents (kind speca.subagents): a card each — model, task, how far by its plan, its report — live
// while they work. Drawn by web/subs.ts (also GET /speca/s/:id/subs/board, which the board asks again every 3 s).
import { subBoard } from "../../web/subs.ts";
import { makeT } from "../../web/i18n/i18n.ts";

export const hint = "this chat's subagents as cards: each one's model, task, how far by its plan and its report, live while they work — args `{}`. Open it when the person wants to watch the subagents' work; their reports still come back to you as usual.";

export default {
  icon: "robot",
  prepare(_ctx: Context, _o: { args: Record<string, any> }) { return { args: {}, title: "Сабагенты" }; },
  async render(ctx: Context, o: { agentId: string; ui?: { t: any } }) {
    return String(await subBoard(ctx, o.ui?.t ?? makeT("ru"), o.agentId));
  },
  describe() { return "the chat's subagents board (live) — use agent.team for their data"; },
};
