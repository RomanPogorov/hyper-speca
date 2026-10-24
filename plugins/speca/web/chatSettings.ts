// The chat's own settings from its header and the sidebar menu: model, effort, autonomy, plan mode, name, pin, archive —
// and the person's interface choices (theme, layout). Model, effort, title and archive are Hyper's; the rest is Speca's.
import type { Ctx } from "./route.ts";
import { noContent, redirect } from "./route.ts";
import { saveSettings, setChat, type HSession } from "./hyper.ts";

const bump = (c: Ctx, id: string) => { try { c.h.fns.procs.events.refresh({ topic: `agent:${id}`, reason: "speca" }); } catch { /* no bus */ } };

export async function setModel(c: Ctx, s: HSession) {
  const v = ((await c.form()).v ?? "").trim();
  if (!v) throw new Error(c.t("chat.noModel", { model: v }));
  await c.h.fns.agent.setModel({ id: s.id, model: v });
  await saveSettings(c.h, c.user.id, { defaultModel: v } as any);
  bump(c, s.id);
  return noContent();
}

export async function setEffort(c: Ctx, s: HSession) {
  const v = (await c.form()).v || "auto";
  await c.h.fns.agent.setReasoningEffort({ id: s.id, effort: v });
  bump(c, s.id);
  return noContent();
}

export async function setAutonomy(c: Ctx, s: HSession) {
  const v = (await c.form()).v;
  if (v !== "read_only" && v !== "ask" && v !== "drafts" && v !== "full") throw new Error("bad level");
  await setChat(c.h, c.user.id, s.id, { autonomy: v });
  await saveSettings(c.h, c.user.id, { defaultAutonomy: v } as any);
  bump(c, s.id);
  return noContent();
}

export async function setMode(c: Ctx, s: HSession) {
  const v = (await c.form()).v === "plan" ? "plan" : "work";
  await setChat(c.h, c.user.id, s.id, { mode: v, ...(v === "plan" ? { autonomy: "read_only" } : {}) });
  bump(c, s.id);
  return noContent();
}

export async function rename(c: Ctx, s: HSession) {
  const title = ((await c.form()).title ?? "").trim().slice(0, 120);
  if (title) await c.h.fns.session.setTitle({ id: s.id, title });
  bump(c, s.id);
  return noContent();
}

export async function pin(c: Ctx, s: HSession) {
  await setChat(c.h, c.user.id, s.id, { pinned: !s.pinned });
  bump(c, s.id);
  return noContent();
}

export async function archive(c: Ctx, s: HSession) {
  const live = c.h.state.agent?.[s.id];
  if (live) await c.h.fns.agent.stop({ agent: live, clearQueue: true }).catch(() => undefined);
  delete c.h.state.agent?.[s.id];
  await c.h.fns.session.archive({ id: s.id });
  try { c.h.fns.procs.events.refresh({ topic: "agents", reason: "archive" }); } catch { /* no bus */ }
  if (c.url.searchParams.has("stay")) return noContent();
  return redirect(c, "/speca");
}

export async function unarchive(c: Ctx, s: HSession) {
  await c.h.fns.session.unarchive({ id: s.id });
  try { c.h.fns.procs.events.refresh({ topic: "agents", reason: "unarchive" }); } catch { /* no bus */ }
  return redirect(c, `/speca/s/${s.id}`);
}

export async function theme(c: Ctx) {
  const v = (await c.form()).theme;
  if (v === "light" || v === "dark" || v === "system") await saveSettings(c.h, c.user.id, { theme: v });
  return noContent();
}

export async function layout(c: Ctx) {
  const f = await c.form();
  const patch: Record<string, unknown> = {};
  if (f.side === "open" || f.side === "closed") patch.sideOpen = f.side === "open";
  if (f.view && ["full", "work", "chat", "solo", "canvas"].includes(f.view)) patch.view = f.view;
  if (f.sb === "rail" || f.sb === "open") patch.sbRail = f.sb === "rail";
  if (Object.keys(patch).length) await saveSettings(c.h, c.user.id, patch as any);
  return noContent();
}
