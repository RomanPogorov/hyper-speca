// Shared by the chat's code routes (/speca/s/:id/changes…, /speca/s/:id/files…): the chat, its workspace folder.
import type { Ctx } from "../route.ts";
import { chatOf } from "../pages.ts";
import { tabsOf } from "../canvas.ts";
import { codeDir, FilesError } from "./files.ts";

export async function codeOf(c: Ctx) {
  const s = await chatOf(c);
  const code = await codeDir(c.h, s.id);
  if (!code) throw new Error(c.t("common.notFound"));
  // Hyper's chats are their owner's: whoever may open the chat may edit its folder
  return { s, dir: code.dir, h: code.h, canEdit: true };
}

export const filesErr = (e: unknown) => e instanceof FilesError
  ? Response.json({ error: e.code, message: e.message }, { status: e.code === "changed" || e.code === "exists" ? 409 : 400 }) : null;

/** Open the chat's tab of this kind (or bring it up) with this view state. */
export async function openKindTab(c: Ctx, sid: string, kind: string, title: string, state: Record<string, unknown> | null) {
  const open = (await tabsOf(c, sid)).find((x: any) => x.kind === kind && !x.closed);
  const tab = open ?? (await c.h.fns.canvas.show({ agentId: sid, kind, args: {}, title }));
  if (state) await c.h.fns.canvas.setState({ agentId: sid, itemId: tab.id, state: { turnId: null, file: null, path: null, ...state } });
  await c.h.fns.canvas.update({ agentId: sid, open: true, activeItemId: tab.id });
  await c.h.fns.canvas.notify({ agentId: sid });
  return null;
}
