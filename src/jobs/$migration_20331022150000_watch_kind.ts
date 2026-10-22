// Watches are durable triggers like wake/cron: kind 'schedule' (runner watch). kind 'subscription' is for
// pushed event subscriptions (runner attach) only. Earlier migrations and jobs.schedule put watches under 'subscription'.
export default {
    up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: "UPDATE jobs SET kind = 'schedule' WHERE runner = 'watch' AND kind <> 'schedule'" }); },
    down: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: "UPDATE jobs SET kind = 'subscription' WHERE runner = 'watch'" }); },
};
