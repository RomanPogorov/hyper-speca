// The person's own terminal (kind speca.terminal), as Speca's servers.terminal: a live shell on this computer or one
// of Hyper's SSH servers, typed by the person. Drawn by web/term.ts; the same session opens full screen at
// /speca/term?s=… (a phone). Agents run commands with remote.exec / bash, not here.
import { termView, TERM_ASSETS } from "../../web/term.ts";
import { html } from "../../web/html.ts";

export const hint = "the person's own interactive terminal, typed by them — args `{ server?: a name from remote.servers, or \"@mac\" for this computer; leave it out to let them choose }`. Open it when the person wants to work in a shell themselves; to run commands yourself use remote.exec or bash.";

export default {
  icon: "terminal-window",
  prepare(_ctx: Context, o: { args: Record<string, any> }) {
    const server = typeof o.args.server === "string" ? o.args.server.trim().slice(0, 60) : "";
    return { args: { server }, title: server ? `Терминал · ${server === "@mac" ? "этот компьютер" : server}` : "Терминал" };
  },
  async render(ctx: Context, o: { agentId: string; item: { id: number; args: Record<string, any>; state?: Record<string, any> }; ui?: { t: { locale: string } } }) {
    const place = String(o.item.state?.server ?? o.item.args?.server ?? "");
    return String(html`${await termView(ctx, o.ui?.t.locale ?? "ru", place, { tab: o.item.id })}${TERM_ASSETS}`);
  },
  describe(_ctx: Context, o: { item: { args: Record<string, any>; state?: Record<string, any> } }) {
    const p = String(o.item.state?.server ?? o.item.args?.server ?? "");
    return `the person's terminal${p ? ` on ${p}` : " (no place chosen yet)"} — they type in it; you cannot read or type there`;
  },
};
