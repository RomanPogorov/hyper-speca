// GET /speca/agents — everyone at work for the person across all chats, and what waits for them (web/views/agents.ts).
import { route } from "../../web/route.ts";
import { ownPage } from "../../web/pages.ts";
import { agentsHtml } from "../../web/views/agents.ts";

export default route(async (c) => ownPage(c, { title: c.t("agents.title"), page: "agents", body: await agentsHtml(c.h, c.user, c.t) }));
