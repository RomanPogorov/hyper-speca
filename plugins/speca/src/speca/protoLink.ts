import { DESIGN_KINDS, link } from "../../web/proto.ts";
import { agentOf } from "../../web/design/tools.ts";

/**
 * Links a tab to the design canvas it was built from — a clickable prototype (an html tab) of a design. Call it right
 * after canvas.show {kind: "html", …} opened the prototype's shell. The two are then linked: the person sees which
 * design the prototype follows, the design shows "Prototype", and either side lights "Update" when the other changed.
 * Build a prototype in steps the person watches (shell first, then one screen per canvas.edit); when it matches the
 * design, call speca.protoSynced.
 * @param opts.itemId The built tab (the prototype).
 * @param opts.from The design canvas tab it is built from.
 */
export default async function (ctx: Context, session: Session | null, opts: {
  /** The built tab (the prototype). */
  itemId: number;
  /** The design canvas tab it is built from. */
  from: number;
}): Promise<string> {
  const agentId = await agentOf(ctx, session);
  const src = await ctx.fns.canvas.tab({ itemId: Number(opts.from), ...(agentId ? { agentId } : {}) });
  const built = await ctx.fns.canvas.tab({ itemId: Number(opts.itemId), ...(agentId ? { agentId } : {}) });
  if (!DESIGN_KINDS.has(src.kind)) throw new Error(`speca.protoLink: tab ${src.id} is ${src.kind}, not a design canvas`);
  if (built.kind !== "html") throw new Error(`speca.protoLink: a prototype is an html tab (tab ${built.id} is ${built.kind})`);
  await link(ctx as any, built.id, src.id);
  await ctx.fns.canvas.notify({ agentId: built.agentId }).catch(() => {});
  return `Tab ${built.id} "${built.title}" is linked as the prototype of design ${src.id} "${src.title}". When it matches the design, call speca.protoSynced {itemId: ${built.id}}.`;
}
