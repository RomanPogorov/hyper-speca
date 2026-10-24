/**
 * Run one of the person's routines (Settings → Routines): start a new chat titled after it and give its agent the
 * routine's prompt. Called by Hyper's cron (tasks named speca.routine.*); a weekday routine skips Saturday and Sunday
 * in its time zone unless forced ("Run now").
 * @param opts.title The chat's title.
 * @param opts.prompt What the agent is asked to do.
 * @param opts.tz The routine's time zone (for its weekdays).
 * @param opts.days Weekdays it runs on, 0 = Sunday; all when empty.
 * @param opts.force Run even on a day it does not run. @default false
 * @param opts.name The cron task's name, to remember the chat it started (the brief on My day reads it).
 */
export default async function (ctx: Context, _session: Session | null, opts: {
  /** The chat's title. */ title?: string;
  /** What the agent is asked to do. */ prompt: string;
  /** The routine's time zone. */ tz?: string;
  /** Weekdays it runs on, 0 = Sunday. */ days?: number[] | null;
  /** Run even on a day it does not run. @default false */ force?: boolean;
  /** The cron task's name. */ name?: string;
  [k: string]: unknown;
}): Promise<{ agentId: string | null; skipped?: string }> {
  const prompt = String(opts.prompt ?? "").trim();
  if (!prompt) throw new Error("speca.routineRun: pass prompt");
  if (!opts.force && Array.isArray(opts.days) && opts.days.length) {
    let wd = "";
    try { wd = new Intl.DateTimeFormat("en-US", { timeZone: opts.tz || undefined, weekday: "short" }).format(new Date()); } catch { wd = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(new Date()); }
    const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
    if (!opts.days.includes(dow)) return { agentId: null, skipped: `not on ${wd}` };
  }
  const made = await (ctx.fns as any).agent.createFromValues({ title: String(opts.title ?? "").slice(0, 120), projectId: "" });
  if (made?.error || !made?.agent) throw new Error(String(made?.error ?? "could not start a chat"));
  const id = String(made.agent.id);
  const body = new FormData();
  body.set("text", prompt);
  body.set("requestId", `${id}:routine`);
  const res: Response = await (ctx.fns as any).agent.acceptMessage({ req: new Request(`http://localhost/agent/${id}/messages`, { method: "POST", body }), params: { id } });
  if (res.status >= 400) throw new Error(`message not accepted (${res.status})`);
  if (opts.name) await ctx.fns.procs.db.run({ sql: "UPDATE cron_tasks SET args = args || jsonb_build_object('lastAgent', ?::text) WHERE name = ?", params: [id, String(opts.name)] }).catch(() => {});
  return { agentId: id };
}
