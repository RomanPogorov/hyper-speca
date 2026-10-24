// POST /speca/tasks/:id/done — mark a Hyper task done.
import { route, toast } from "../../web/route.ts";

export default route(async (c) => { await c.h.fns.tasks.setStatus({ id: c.params.id!, status: "done" }); return toast(c.t("dy.taskDone"), "", "success", { "dh-reload": true }); });
