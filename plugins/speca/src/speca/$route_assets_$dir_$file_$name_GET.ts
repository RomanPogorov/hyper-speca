// GET /speca/assets/:dir/:sub/:name — Speca's files one folder deeper (vendor/fonts/…).
import { asset } from "../../web/assets.ts";

export default async function (_ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
  return asset(opts.req, [opts.params.dir!, opts.params.file!, opts.params.name!]);
}
