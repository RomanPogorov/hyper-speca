// GET /speca/s/:id/changes/file?path&turn — one file before and after a turn (or the whole chat); false = not text.
import { route } from "../../web/route.ts";
import { fileVersions } from "../../web/code/changes.ts";
import { codeOf } from "../../web/code/routes.ts";

export default route(async (c) => {
  const { s, h } = await codeOf(c);
  const v = await fileVersions(c.h, s.id, h, String(c.url.searchParams.get("path") ?? ""), { turnId: c.url.searchParams.get("turn") || undefined }).catch(() => null);
  if (!v) return Response.json({ before: null, after: null });
  // big or binary files: not shown as text
  const fit = (x: string | null) => (x === null ? null : x.length > 1_500_000 || x.includes("\0") ? false : x);
  return Response.json({ before: fit(v.before), after: fit(v.after) });
});
