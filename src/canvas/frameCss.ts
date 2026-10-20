/**
 * Returns the compiled app stylesheet as text, for inlining into sandboxed canvas frames
 *
 * A sandboxed canvas frame (an html tab, opaque origin, CSP without 'self') cannot link /procs/styles/app.css: it has no cookie and no own origin. This returns the same Tailwind-compiled sheet the Hyper page uses (theme tokens for light and dark, preflight, components, utilities, prose) so the frame's document can carry it inline in a <style>. Cached per compiled file and its modification time; a rebuild of the sheet is picked up on the next call. Use from canvas.htmlFrame or any other frame document that must look like Hyper without network access.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    _opts: {},
): Promise<string> {
    const app = ((ctx.state.procs as any).styles ?? []).find((s: any) => String(s.href).startsWith("/procs/styles/"));
    if (!app) return "";
    const path = await ctx.fns.procs.styles.build({ abs: app.abs, key: app.key });
    const file = Bun.file(path);
    const stamp = path + ":" + (await file.stat().then(s => s.mtimeMs, () => 0));
    const cache = ((ctx.state as any).canvas ??= {}).frameCss as { stamp: string; css: string } | undefined;
    if (cache?.stamp === stamp) return cache.css;
    // Inlined into a <style>: no "</" may close it early.
    const css = (await file.text()).replace(/<\//g, "<\\/");
    (ctx.state as any).canvas.frameCss = { stamp, css };
    return css;
}
