import { join } from "node:path";

/**
 * Returns the rules of Speca's design canvas: when to use it, the order of work and how an artboard file is written
 * so the person's editor works on it (fluid roots, inline styles, alike elements, data + `<dc-for>` repeats,
 * `<dc-import>` components, links between artboards). Read it before drawing the first artboard.
 */
export default async function (_ctx: Context, _session: Session | null, _opts: {}): Promise<string> {
  const dir = join(import.meta.dir, "..", "..", "web", "design");
  const [guide, kit] = await Promise.all([Bun.file(join(dir, "design.prompt.md")).text(), Bun.file(join(dir, "COMPONENTS.md")).text().catch(() => "")]);
  return kit ? `${guide}\n\n---\n\n${kit}` : guide;
}
