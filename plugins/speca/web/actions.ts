// What the chat's controls do, on Hyper's agents: send a message, stop, start a new chat.
import type { Ctx } from "./route.ts";
import { redirect } from "./route.ts";
import { getSession, type HSession } from "./hyper.ts";
import { chatCtx } from "./pages.ts";
import { queueDock } from "./views/chat.ts";
import { takeUploads } from "./uploads.ts";

/** The composer's POST: the text and the waiting files go to Hyper as one message (agent.acceptMessage). */
export async function sendMessage(c: Ctx, s: HSession) {
  const fd = await c.formAll();
  const text = String(fd.get("text") ?? "").trim();
  const files = takeUploads(c, fd.getAll("att").map(String).slice(0, 20));
  if (!text && !files.length) return null;
  await say(c, s, text, String(fd.get("key") ?? "") || `q${Date.now().toString(36)}`, files);
  // Hyper takes the message at once (no inbox): the log shows it on the next live refresh
  return queueDock(await chatCtx(c, (await getSession(c.h, c.user.id, s.id)) ?? s), []);
}

/** A message to the chat's agent as the person (the composer, the canvas's comments and buttons). */
export async function say(c: Ctx, s: HSession, text: string, key: string, files: File[] = []) {
  const body = new FormData();
  body.set("text", text);
  body.set("requestId", `${s.id}:${key}`);
  for (const f of files) body.append("files", f, f.name);
  const req = new Request(new URL(`/agent/${encodeURIComponent(s.id)}/messages`, c.url), { method: "POST", body });
  const res: Response = await c.h.fns.agent.acceptMessage({ req, params: { id: s.id } });
  if (res.status >= 400) {
    const j = await res.json().catch(() => ({} as any));
    throw new Error(String(j?.error ?? `message not accepted (${res.status})`));
  }
}

export async function stopChat(c: Ctx, s: HSession) {
  const agent = c.h.state.agent?.[s.id];
  if (agent) await c.h.fns.agent.stop({ agent, clearQueue: false });
  return null;
}

/** "New chat": a Hyper agent with the default model; the first words, when given, are its first message. */
export async function newChat(c: Ctx) {
  const f = await c.form();
  const made = await c.h.fns.agent.createFromValues({ title: f.title ?? "", projectId: f.project ?? "" });
  if (made.error || !made.agent) throw new Error(made.error ?? "could not start a chat");
  const id = String(made.agent.id);
  if (f.text?.trim()) {
    const body = new FormData();
    body.set("text", f.text.trim());
    await c.h.fns.agent.acceptMessage({ req: new Request(new URL(`/agent/${id}/messages`, c.url), { method: "POST", body }), params: { id } });
  }
  return redirect(c, `/speca/s/${id}`);
}
