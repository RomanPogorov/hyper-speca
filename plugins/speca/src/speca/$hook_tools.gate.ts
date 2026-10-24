// Speca's confirmations: every tool call of an agent is weighed by the chat's mode and autonomy (web/approvals.ts);
// one that needs the person waits on an approval card in the chat.
import { gate } from "../../web/approvals.ts";

/** Let a tool call run, deny it, or hold it for the person's decision.
 * @param opts.agentId Agent making the call.
 * @param opts.tool The tool's wire name.
 * @param opts.args Its validated arguments.
 * @param opts.signal Aborts when the call or the agent is stopped.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Agent making the call. */
    agentId: string;
    /** The tool's wire name. */
    tool: string;
    /** Its validated arguments. */
    args: any;
    /** Aborts when the call or the agent is stopped. */
    signal?: AbortSignal;
}): Promise<null | { deny: string }> {
    return gate(ctx as any, opts);
}
