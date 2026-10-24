// The Changes tab (kind speca.changes, Speca's canvas-kit.changes): the files the agent changed in the chat's
// workspace folder — one turn or the whole chat — as diffs (snapshots at each turn's start and end, web/code/
// changes.ts). Opened from the chat's "N files changed" card. The view is drawn by assets/js/changes.js.
import { html } from "../../web/html.ts";
import { ic } from "../../web/ui/icons.ts";

type Item = { id: number; args: Record<string, any>; state?: Record<string, any> };
const L = {
  en: { all: "Whole chat", turn: "Turn", split: "Side by side", unified: "One column", wrap: "Wrap lines", none: "No changes in this chat yet.", binary: "Binary or too large to show", files: "Files", loading: "Loading…", byHand: "By hand", revertFile: "Revert this file", revertScope: "Revert these changes", revertAsk: "Put {name} back as it was before? Nothing is touched if it changed again since.", revertAllAsk: "Put {n} files back as they were before? Nothing is touched if any changed again since." },
  ru: { all: "Весь чат", turn: "Ход", split: "В две колонки", unified: "В одну колонку", wrap: "Переносить строки", none: "В этом чате пока нет изменений.", binary: "Двоичный или слишком большой файл", files: "Файлы", loading: "Загрузка…", byHand: "Вручную", revertFile: "Откатить файл", revertScope: "Откатить эти изменения", revertAsk: "Вернуть {name} как было до этого? Если он менялся после, ничего не тронем.", revertAllAsk: "Вернуть файлы ({n}) как было до этого? Если какой-то менялся после, ничего не тронем." },
};

export const hint = "the files changed in this chat's workspace folder, per turn or for the whole chat, as diffs — opened by the person from the changes card in the chat; you do not need to open it";

export default {
  icon: "git-diff",
  prepare(_ctx: Context, o: { args: Record<string, any> }) {
    void o; return { args: {}, title: "Изменения" };
  },
  render(_ctx: Context, o: { agentId: string; item: Item; ui?: { t: { locale: string } } }) {
    const l = L[o.ui?.t.locale === "en" ? "en" : "ru"], st = o.item.state ?? {};
    return String(html`<div class="chg-view" data-session="${o.agentId}" data-turn="${st.turnId ?? ""}" data-file="${st.file ?? ""}" data-l="${JSON.stringify(l)}" data-undo="${String(ic("undo", "ic-sm"))}"></div><script type="module" src="/speca/assets/js/changes.js"></script>`);
  },
  describe(_ctx: Context, o: { item: Item }) {
    const st = o.item.state ?? {};
    return `the chat's file changes as diffs${st.turnId ? ` (turn ${st.turnId})` : " (whole chat)"}${st.file ? `, at ${st.file}` : ""} — the person's view; nothing to edit`;
  },
};
