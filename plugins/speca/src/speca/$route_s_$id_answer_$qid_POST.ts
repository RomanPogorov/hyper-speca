// POST /speca/s/:id/answer/:qid — the person's answers on a question card (speca.askUser): a0…aN (the options they
// picked), o0…oN (their own words), skip.
import { route, toast } from "../../web/route.ts";
import { ApprovalError, decide } from "../../web/approvals.ts";

export default route(async (c) => {
  const fd = await c.formAll();
  const skip = fd.get("skip") === "1";
  const answers: Record<string, string> = {};
  if (!skip) {
    for (let i = 0; i < 5; i++) {
      const picked = fd.getAll(`a${i}`).map(String).filter(Boolean);
      const own = String(fd.get(`o${i}`) ?? "").trim();
      const v = [...picked, ...(own ? [own] : [])].join(", ");
      if (v) answers[i] = v;
    }
  }
  try {
    await decide(c.h, c.params.qid!, skip ? "rejected" : "approved", "", skip ? "skipped" : null, answers);
  } catch (e) {
    if (e instanceof ApprovalError) return toast(c.t(`appr.err.${e.code === "not_found" ? "not_pending" : e.code}` as never), "", "error");
    throw e;
  }
  return toast(c.t("appr.doneToast"));
});
