/** Shows the new-project form.
 * @param opts.req Incoming HTTP request.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Incoming HTTP request. */
    req: Request;
}) {
    const fields = await ctx.fns.project.newForm({});
    return { title: "new project", main: `<div class="flex-1 overflow-y-auto"><form method="POST" action="/project/new" hx-boost="false" class="mx-auto max-w-2xl space-y-4 px-6 py-8" data-form="new-project"><h1 class="text-xl font-semibold">New project</h1>${fields}<div class="flex gap-3">${ctx.fns.procs.ui.button({ action: "create-project", label: "create project", type: "submit", tone: "primary" })}${ctx.fns.procs.ui.button({ action: "cancel-new-project", label: "cancel", href: "/", tone: "ghost" })}</div></form></div>` };
}
