// POST /speca/s/:id/unarchive — bring an archived chat back.
import { route } from "../../web/route.ts";
import { chatOf } from "../../web/pages.ts";
import { unarchive } from "../../web/chatSettings.ts";

export default route(async (c) => unarchive(c, await chatOf(c)));
