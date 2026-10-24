// The file viewer of Speca (kind speca.file): one file shown as it is now — markdown and HTML with a View / Code
// switch, code, text, CSV as a table, JSON, images, PDF — with Open and Download. See web/fileView.ts.
import { fileViewer, resolveFor } from "../../web/fileView.ts";

export const hint = "one file in Speca's viewer — args `{ path, host?, view?: \"view\"|\"code\" }` (path absolute or relative to the chat's folder): markdown and HTML rendered with a View / Code switch, code, text, CSV as a table, JSON, images, PDF, with Download. Open a file with it instead of copying its content into a document; write a new one with speca.writeFile.";

export default {
  icon: "file",
  async prepare(ctx: Context, o: { agentId: string; args: Record<string, any> }) {
    const asked = String(o.args.path ?? o.args.fileId ?? "").trim();
    if (!asked) throw new Error("canvas speca.file: args.path is required");
    const at = await resolveFor(ctx, o.agentId, asked, o.args.host);
    const view = o.args.view === "code" ? "code" : undefined;
    return { args: { path: at.path, ...(at.host ? { host: at.host } : {}), ...(view ? { view } : {}) }, title: at.path.split("/").filter(Boolean).pop() ?? at.path };
  },
  async render(ctx: Context, o: { agentId: string; item: { id: number; args: Record<string, any> }; ui?: { t: { locale: string } } }) {
    const a = o.item.args;
    return String(await fileViewer(ctx, { tabId: o.item.id, path: String(a.path), host: a.host ? String(a.host) : null, view: a.view, locale: o.ui?.t.locale ?? "ru" }));
  },
  describe(_ctx: Context, o: { item: { args: Record<string, any> } }) {
    const a = o.item.args;
    return `file ${a.host ? `${a.host}:` : ""}${a.path} in the viewer — read it with files.read, not from here`;
  },
};
