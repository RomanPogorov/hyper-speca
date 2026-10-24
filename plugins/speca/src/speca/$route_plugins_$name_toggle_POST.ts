// POST /speca/plugins/:name/toggle — turn a plugin on or off for the person, then the dialog again.
import { route } from "../../web/route.ts";
import { pluginsDialog, togglePlugin } from "../../web/plugins.ts";

export default route(async (c) => { await togglePlugin(c, c.params.name!); c.url.searchParams.set("sel", c.params.name!); return pluginsDialog(c); });
