// "To background" for ONE running tool call: the agent stops waiting, the process keeps
// running as a job and reports when it ends. Sibling of the abort route.
/** Handles the id tool runId detach post HTTP route.
 * @param opts.req Incoming HTTP request.
 * @param opts.params Route path parameters.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Incoming HTTP request. */
        req: Request;
        /** Values bound to the operation. */
        params: Record<string, string>;
    },
): Promise<Response> {
    const id = opts.params.id!;
    const runId = opts.params.runId!;
    const run = ctx.fns.tools.runs({ agentId: id }).find(item => item.id === runId);
    if (!run) return Response.json({ error: "no such running tool call" }, { status: 404 });
    const result = ctx.fns.tools.detachRun({ id: runId });
    if (!result.detached) return Response.json({ error: result.reason }, { status: 409 });
    if (opts.req.headers.get("hx-request") === "true") return new Response(null, { status: 204 });
    return Response.json({ ok: true });
}
