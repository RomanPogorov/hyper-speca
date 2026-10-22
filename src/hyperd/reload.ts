/**
 * Rereads hyperd unit files from ~/.hyper/units and reports which loaded and which are invalid
 *
 * Use after adding or editing a unit file. New service units start automatically (autostart); changed units keep running until hyperd.restart. Invalid files are listed in errors with the field that is wrong.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<{ units: string[]; errors: string[] }> {
    return await ctx.fns.hyperd.call({ path: "/reload", body: { autostart: true } });
}
