/**
 * Detaches an agent from an external event source
 *
 * Stop one durable agent attachment by identifier. In-flight delivery is invalidated and the producer is stopped when no active subscriptions remain.
 * @param opts.id Owning agent identifier.
 * @param opts.attachmentId Attachment identifier returned by agent.attach.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Owning agent identifier. */
        id: string;
        /** Attachment identifier returned by agent.attach. */
        attachmentId: string;
    },
): Promise<{ detached: boolean }> {
    const now=Date.now();const rows=await ctx.fns.procs.db.select({sql:"UPDATE jobs SET status='cancelled',outcome_reason='detached',cancel_requested_at=?,updated_at=?,finished_at=? WHERE id=? AND agent_id=? AND runner='attach' AND status='running' RETURNING spec->>'source' AS source",params:[now,now,now,opts.attachmentId,opts.id]}) as any[];if(!rows.length)return{detached:false};await ctx.fns.procs.db.run({sql:"UPDATE attachment_deliveries SET status='failed',claim_token=NULL,claimed_at=NULL,last_error='attachment detached',updated_at=? WHERE attachment_id=? AND status IN ('pending','delivering')",params:[now,opts.attachmentId]});await ctx.fns.agent.stopUnusedAttachments({source:String(rows[0].source)});return{detached:true};
}
