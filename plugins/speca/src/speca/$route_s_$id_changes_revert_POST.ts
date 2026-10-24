// POST /speca/s/:id/changes/revert {turn?, file?} — put a turn's (or the whole chat's, or one file's) changes back;
// nothing is written on a conflict. The answer is a toast (and a reload of the Changes tab).
import { route, toast } from "../../web/route.ts";
import { personRevert } from "../../web/code/files.ts";
import { codeOf } from "../../web/code/routes.ts";

export default route(async (c) => {
  const { s, dir, h } = await codeOf(c);
  const f = await c.form();
  const r = await personRevert(c.h, h, { agentId: s.id, userId: c.user.id, dir }, { turnId: f.turn || undefined, paths: f.file ? [String(f.file)] : undefined });
  if (!r) return toast(c.t("chg.revertNone"), "", "info");
  if (r.conflicts.length) return toast(c.t("chg.revertConflict"), r.conflicts.slice(0, 8).join(", "), "error", { "dh-chg-reload": {} });
  if (!r.reverted.length) return toast(c.t("chg.revertNothing"), "", "info");
  return toast(c.t("chg.reverted", { n: r.reverted.length }), r.reverted.slice(0, 8).join(", "), "success", { "dh-chg-reload": {} });
});
