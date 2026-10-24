// POST /speca/coordinator/ask — the ask line of My day: the words go to the coordinator chat, which opens.
import { route, redirect, noContent } from "../../web/route.ts";
import { coordinatorId } from "../../web/day.ts";
import { getSession } from "../../web/hyper.ts";
import { say } from "../../web/actions.ts";

export default route(async (c) => {
  const text = ((await c.form()).text ?? "").trim();
  if (!text) return noContent();
  const id = await coordinatorId(c);
  const s = await getSession(c.h, c.user.id, id);
  if (!s) throw new Error(c.t("common.notFound"));
  await say(c, s, text, `d${Date.now().toString(36)}`, []);
  return redirect(c, `/speca/s/${id}`);
});
