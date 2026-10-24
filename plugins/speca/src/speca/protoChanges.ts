import { changesSince, linksText } from "../../web/proto.ts";
import { agentOf } from "../../web/design/tools.ts";

/**
 * What changed on one side of a design ↔ prototype link since they last matched: for a design canvas, the artboards
 * added, removed and changed (what changed in each: texts, styles, elements); for a prototype, a diff of its html.
 * Read it before updating the other side, and change only that. Without itemId: every link of this chat and its
 * state (in step / the design changed / the prototype changed).
 * @param opts.itemId The design or the prototype to read. @default the list of links
 */
export default async function (ctx: Context, session: Session | null, opts: {
  /** The design or the prototype to read. @default the list of links */
  itemId?: number;
}): Promise<string> {
  if (opts.itemId != null) return changesSince(ctx as any, Number(opts.itemId));
  const agentId = await agentOf(ctx, session);
  if (!agentId) throw new Error("speca.protoChanges: pass itemId");
  return (await linksText(ctx as any, agentId)) || "No prototypes are linked to designs in this chat.";
}
