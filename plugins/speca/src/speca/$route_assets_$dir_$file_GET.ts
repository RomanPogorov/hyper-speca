// GET /speca/assets/:dir/:file — Speca's stylesheets, scripts and images.
import { asset } from "../../web/assets.ts";

export default async function (_ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
  return asset(opts.req, [opts.params.dir!, opts.params.file!]);
}
