// POST /speca/tasks/:id/start — give a Hyper task to an agent (tasks.start).
import { route, toast } from "../../web/route.ts";

export default route(async (c) => { await c.h.fns.tasks.start({ id: c.params.id! }); return toast(c.t("set.started"), "", "success", { "dh-reload": true }); });
