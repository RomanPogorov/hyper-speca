import { markSynced } from "../../web/proto.ts";

/**
 * Marks a prototype and its design as matching again: after you brought the prototype up to date with the design
 * ("Update prototype"), or the design with changes made in the prototype ("Bring into design"). Their "changed"
 * marks go out and the next speca.protoChanges counts from now.
 * @param opts.itemId The prototype or the design.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
  /** The prototype or the design. */
  itemId: number;
}): Promise<string> {
  const r = await markSynced(ctx as any, Number(opts.itemId));
  if (!r) throw new Error(`speca.protoSynced: tab ${opts.itemId} has no linked design or prototype (link one with speca.protoLink)`);
  const t = await ctx.fns.canvas.tab({ itemId: r.built });
  await ctx.fns.canvas.notify({ agentId: t.agentId }).catch(() => {});
  return `Prototype ${r.built} and design ${r.source} are in step now.`;
}
