// GET /speca/artifacts — everything chats produced: canvases, design artboards, media, files, links (web/artifacts.ts).
import { route } from "../../web/route.ts";
import { ownPage } from "../../web/pages.ts";
import { artifactsHtml } from "../../web/artifacts.ts";

export default route(async (c) => ownPage(c, { title: c.t("art.title"), page: "artifacts", body: await artifactsHtml(c) }));
