// POST /speca/approvals/:id {decision, hash, note?} — the person's decision on an approval card or a plan.
import { route, toast } from "../../web/route.ts";
import { ApprovalError, decide } from "../../web/approvals.ts";
import { setChat } from "../../web/hyper.ts";

export default route(async (c) => {
  const f = await c.form();
  const ok = f.decision === "approved";
  try {
    const r = await decide(c.h, c.params.id!, ok ? "approved" : "rejected", f.hash ?? "", f.note?.trim() || null);
    // an approved plan: the chat goes to work (read only becomes "ask before changes", as Speca does)
    if (r.kind === "plan" && ok) {
      const [row] = await c.h.fns.procs.db.select({ sql: `SELECT autonomy FROM speca_chat WHERE agent_id = ? AND user_id = ?`, params: [r.chatId, c.user.id] });
      await setChat(c.h, c.user.id, r.chatId, { mode: "work", ...(!row?.autonomy || row.autonomy === "read_only" ? { autonomy: "ask" } : {}) });
    }
  } catch (e) {
    if (e instanceof ApprovalError) return toast(c.t(`appr.err.${e.code === "not_found" ? "not_pending" : e.code}` as never), "", "error");
    throw e;
  }
  return toast(ok ? c.t("appr.doneToast") : c.t("appr.rejectedToast"));
});
