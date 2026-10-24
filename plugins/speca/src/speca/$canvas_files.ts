// The Files tab (kind speca.files, Speca's canvas-kit.files): the whole workspace folder of the chat — a tree, search
// by name, a file with highlighting — and editing and saving by the person (web/code/files.ts: the gate, a snapshot
// like a turn's, a note to the agent). Opened from the chat's composer bar. Drawn by assets/js/files.js.
import { html } from "../../web/html.ts";
import { ic } from "../../web/ui/icons.ts";

type Item = { id: number; args: Record<string, any>; state?: Record<string, any> };
const ICONS = ["folder", "file", "chevRight", "chevLeft", "plus", "folderPlus", "at", "copy", "fileDiff", "pencil", "trash", "download", "search", "check", "image"];
const L = {
  en: { search: "Find a file", back: "All files", none: "No files match", loading: "Loading…", pick: "Pick a file on the left", save: "Save", saved: "Saved", saving: "Saving…", unsaved: "Unsaved changes", readonly: "Read only: only the chat's owner edits files", toChat: "Mention in the chat", copyPath: "Copy the path", copied: "Copied", showDiff: "Show the changes", rename: "Rename", del: "Delete", delAsk: "Delete {name}?", download: "Download", newFile: "New file", newFolder: "New folder", newName: "Name (a path inside the project)", renameTo: "New name", binary: "Binary file — not shown as text", large: "Too large to show", changed: "The file changed on disk since you opened it.", reload: "Load it again", overwrite: "Save mine over it", more: "Showing the first {n} files", st: { A: "added in this chat", M: "changed in this chat", D: "deleted in this chat", R: "renamed in this chat" }, error: "Could not do that" },
  ru: { search: "Найти файл", back: "Все файлы", none: "Ничего не найдено", loading: "Загрузка…", pick: "Выберите файл слева", save: "Сохранить", saved: "Сохранено", saving: "Сохраняю…", unsaved: "Есть несохранённые правки", readonly: "Только чтение: править файлы может владелец чата", toChat: "Упомянуть в чате", copyPath: "Скопировать путь", copied: "Скопировано", showDiff: "Показать изменения", rename: "Переименовать", del: "Удалить", delAsk: "Удалить {name}?", download: "Скачать", newFile: "Новый файл", newFolder: "Новая папка", newName: "Имя (путь внутри проекта)", renameTo: "Новое имя", binary: "Двоичный файл — не показываем как текст", large: "Слишком большой, чтобы показать", changed: "Файл изменился на диске, пока был открыт.", reload: "Загрузить заново", overwrite: "Сохранить свой поверх", more: "Показаны первые {n} файлов", st: { A: "добавлен в этом чате", M: "изменён в этом чате", D: "удалён в этом чате", R: "переименован в этом чате" }, error: "Не получилось" },
};

export const hint = "the chat's workspace folder, browsed and edited by the person — opened by the person; you do not need to open it. When the person saves a file there you are told before your next turn";

export default {
  icon: "tree-structure",
  prepare(_ctx: Context, _o: { args: Record<string, any> }) { return { args: {}, title: "Файлы" }; },
  render(_ctx: Context, o: { agentId: string; item: Item; ui?: { t: { locale: string } } }) {
    const l = L[o.ui?.t.locale === "en" ? "en" : "ru"], sid = o.agentId, st = o.item.state ?? {};
    // the view itself is kept across redraws of the canvas (hx-preserve): typing goes on while the agent works; the
    // file to show comes with the redraw on the element next to it
    return String(html`<div class="pf-view" id="pf-${sid}" hx-preserve="true" data-session="${sid}" data-l="${JSON.stringify(l)}" data-icons="${JSON.stringify(Object.fromEntries(ICONS.map((n) => [n, String(ic(n, "ic-xs"))])))}"></div><i class="pf-live" hidden data-session="${sid}" data-path="${st.path ?? ""}" data-live-topic="session:${sid}"></i><script type="module" src="/speca/assets/js/files.js"></script>`);
  },
  describe(_ctx: Context, o: { item: Item }) {
    return `the workspace folder in the person's file browser${o.item.state?.path ? `, showing ${o.item.state.path}` : ""} — theirs; nothing to edit`;
  },
};
