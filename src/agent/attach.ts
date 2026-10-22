/**
 * Attaches an agent to a durable external event source
 *
 * Create a durable subscription from one agent to a declared $attach producer. Use when new external events should wake the same agent conversation until explicitly detached.
 * @param opts.id Target agent identifier.
 * @param opts.source Declared attachment source, such as telegram.
 * @param opts.events Event types to accept; empty accepts every type.
 * @param opts.filter Source-specific event filter.
 * @param opts.prompt Optional prefix inserted before the normalized event payload.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Target agent identifier. */
        id: string;
        /** Declared attachment source, such as telegram. */
        source: string;
        /** Event types to accept; empty accepts every type. */
        events?: string[];
        /** Source-specific event filter. */
        filter?: Record<string, any>;
        /** Optional prefix inserted before the normalized event payload. */
        prompt?: string;
    },
): Promise<{ id: string; source: string }> {
    const id=String(opts.id??"").trim(),source=String(opts.source??"").trim();if(!id||!source)throw new Error("agent.attach: id and source are required");const exists=(await ctx.fns.procs.db.select({sql:"SELECT id FROM agents WHERE id=? AND archived_at IS NULL",params:[id]}))[0];if(!exists)throw new Error(`agent not found: ${id}`);const declared=(ctx.state as any).attachments?.declarations?.[source];if(!declared)throw new Error(`attachment source not found: ${source}`);const events=Array.isArray(opts.events)?[...new Set(opts.events.map(String).filter(Boolean))]:[];if(declared.events?.length){for(const event of events)if(!declared.events.includes(event))throw new Error(`unsupported ${source} event: ${event}`);}const attachmentId=`att_${Bun.randomUUIDv7()}`,now=Date.now();// A subscription is a jobs row (kind subscription, runner attach, next_at NULL: jobs.poll never ticks it; events push).
await ctx.fns.procs.db.run({sql:"INSERT INTO jobs(id,kind,runner,spec,state,status,owner_id,created_by,agent_id,prompt,execution_id,created_at,started_at,updated_at) SELECT ?,'subscription','attach',?::jsonb,'{}'::jsonb,'running',created_by,?,id,?,?,?,?,? FROM agents WHERE id=?",params:[attachmentId,JSON.stringify({title:`${source}${events.length?" "+events.join(","):""}`,source,events,filter:opts.filter??{}}),session?.user?.id??(session?.agentId?"agent:"+session.agentId:null),opts.prompt?String(opts.prompt):null,attachmentId,now,now,now,id]});await ctx.fns.agent.startAttachments({source});return{id:attachmentId,source};
}
