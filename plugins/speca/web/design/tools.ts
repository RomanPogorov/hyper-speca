// What the design functions (speca.designOpen / designWrite / designEdit / designRead / designLayout) and the design
// routes share: the tab and its state, writing it as one edit of the draft, pointing the person at an artboard.
import { checkState, type DesignState } from "./model.ts";

export type DesignTab = { id: number; agentId: string; title: string; state: Record<string, any>; design: DesignState };

/** The design canvas of a tab id (the agent's own when it is the agent asking). */
export async function loadBoard(ctx: Context, tabId: number | string, agentId?: string): Promise<DesignTab> {
  const tab = await ctx.fns.canvas.tab({ itemId: Number(tabId), ...(agentId ? { agentId } : {}) }).catch(() => null);
  if (!tab || tab.kind !== "speca.design") throw new Error(`No design canvas ${tabId} (use the tab id from speca.designOpen or the Canvas block).`);
  const r = checkState(tab.args);
  if (!r.ok) throw new Error(`The design canvas state is broken: ${r.error}`);
  return { id: tab.id, agentId: tab.agentId, title: tab.title, state: tab.state ?? {}, design: structuredClone(r.state) };
}

/** The agent asking (its canvas only); none from a route. */
export async function agentOf(ctx: Context, session: Session | null): Promise<string | undefined> {
  if (session?.kind !== "agent") return undefined;
  return (await ctx.fns.agent.current({}).catch(() => null))?.id;
}

export async function save(ctx: Context, b: DesignTab, design: DesignState, note: string, author?: string) {
  await ctx.fns.canvas.write({ itemId: b.id, args: design, note, ...(author ? { author } : {}) });
}

/** The person follows the work: the artboard drawn or changed comes into view (the tab to the front, once). */
export async function focus(ctx: Context, b: DesignTab, file: string) {
  await ctx.fns.canvas.setState({ itemId: b.id, agentId: b.agentId, state: { focus: { target: file, at: Date.now(), follow: true } } }).catch(() => {});
  await ctx.fns.canvas.notify({ agentId: b.agentId }).catch(() => {});
}

export const sizes = { phone: { w: 390, h: 844 }, tablet: { w: 834, h: 1194 }, desktop: { w: 1440, h: 900 }, slide: { w: 1280, h: 720 } } as const;
