// Attachments the composer uploads before the message is sent (POST /speca/uploads → a chip with a hidden `att` id).
// Hyper saves a message's files with the message itself (agent.acceptMessage), so until then a file waits here, in
// memory, for an hour; the message hands the waiting files to Hyper.
import { html, type Raw } from "./html.ts";
import { ic } from "./ui/icons.ts";
import type { Ctx } from "./route.ts";

type Waiting = { file: File; userId: string; sid: string | null; at: number };
const HOUR = 3_600_000;

function store(h: any): Map<string, Waiting> {
  const st = (h.state.speca ??= {}) as { uploads?: Map<string, Waiting> };
  return (st.uploads ??= new Map());
}

export async function upload(c: Ctx): Promise<Raw> {
  const fd = await c.formAll();
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) throw new Error("no file");
  if (file.size > 50 * 1024 * 1024) throw new Error("file is over 50 MB");
  const m = store(c.h);
  const now = Date.now();
  for (const [k, w] of m) if (now - w.at > HOUR) m.delete(k);
  const id = `u${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  m.set(id, { file, userId: c.user.id, sid: String(fd.get("session") ?? "") || null, at: now });
  const isImg = file.type.startsWith("image/");
  const thumb = isImg ? `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}` : "";
  return html`<span class="cchip att" data-att="${id}" data-name="${file.name}">${isImg ? html`<img src="${thumb}" alt="">` : ic("paperclip", "ic-xs")}<span class="mono">${file.name}</span><input type="hidden" name="att" value="${id}"><button type="button" data-act="chip-x" aria-label="${c.t("composer.dropFile")}">${ic("x", "ic-xs")}</button></span>`;
}

/** The person's waiting files by their ids, taken out of the store. */
export function takeUploads(c: Ctx, ids: string[]): File[] {
  const m = store(c.h);
  const out: File[] = [];
  for (const id of ids) {
    const w = m.get(id);
    if (w && w.userId === c.user.id) { out.push(w.file); m.delete(id); }
  }
  return out;
}
