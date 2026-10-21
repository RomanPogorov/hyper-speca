import { describe, expect, test } from 'bun:test';
import { mkTestCtx } from '../_testCtx.entry';

async function fixture() {
    const ctx: any = await mkTestCtx();
    await ctx.fns.procs.db.exec({ sql: "INSERT INTO agents(id,model,system_prompt,scratchpad,created_at,updated_at,created_by) VALUES ('rx','mock:echo','','{}',0,0,'owner'),('arch','mock:echo','','{}',0,0,'owner')" });
    await ctx.fns.procs.db.exec({ sql: "UPDATE agents SET archived_at = 1 WHERE id = 'arch'" });
    ctx.state.registry.agent.wakeWorker = () => {};
    return ctx;
}
async function counts(ctx: any, id = 'rx') {
    const row = (await ctx.fns.procs.db.select({
        sql: "SELECT (SELECT count(*)::int FROM messages WHERE agent_id=?) messages,(SELECT count(*)::int FROM events WHERE agent_id=?) events,(SELECT count(*)::int FROM session_notification_receipts WHERE agent_id=?) receipts,(SELECT next_run_at FROM agents WHERE id=?) wake",
        params: [id, id, id, id],
    }))[0];
    return { ...row, wake: row.wake == null ? null : Number(row.wake) };
}

describe('agent.deliver', () => {
    test('writes message, event, receipt and wake together; message counts for the cursor', async () => {
        const ctx = await fixture();
        const r = await ctx.fns.agent.deliver({ to: 'rx', type: 'trigger', text: 'ping', key: 'k1', event: { type: 'wake_up', reason: 'ping' }, now: 1000 });
        expect(r).toEqual({ delivered: true, duplicate: false, messageIdx: 0, eventIdx: 0 });
        expect(await counts(ctx)).toEqual({ messages: 1, events: 1, receipts: 1, wake: 1000 });
        const m = (await ctx.fns.procs.db.select({ sql: "SELECT role, message_type, excluded_from_cursor, author FROM messages WHERE agent_id='rx'" }))[0];
        expect(m).toMatchObject({ role: 'user', message_type: 'trigger', excluded_from_cursor: 0, author: null });
        const e = (await ctx.fns.procs.db.select({ sql: "SELECT type, payload FROM events WHERE agent_id='rx'" }))[0];
        expect(e.type).toBe('wake_up');
        expect(JSON.parse(e.payload)).toMatchObject({ reason: 'ping', messageIdx: 0 });
    });

    test('a repeated key is a duplicate, also after the transcript was cleared', async () => {
        const ctx = await fixture();
        await ctx.fns.agent.deliver({ to: 'rx', type: 'trigger', text: 'once', key: 'job:1:end' });
        expect((await ctx.fns.agent.deliver({ to: 'rx', type: 'trigger', text: 'once', key: 'job:1:end' })).duplicate).toBe(true);
        await ctx.fns.session.truncateMessagesFrom({ id: 'rx', from: 0 });
        await ctx.fns.procs.db.run({ sql: "UPDATE agents SET next_run_at = NULL WHERE id = 'rx'" });
        const again = await ctx.fns.agent.deliver({ to: 'rx', type: 'trigger', text: 'once', key: 'job:1:end' });
        expect(again).toMatchObject({ delivered: false, duplicate: true });
        expect(await counts(ctx)).toEqual({ messages: 0, events: 0, receipts: 1, wake: null });
    });

    test('concurrent deliveries of one key produce exactly one message', async () => {
        const ctx = await fixture();
        const results = await Promise.all(Array.from({ length: 6 }, () => ctx.fns.agent.deliver({ to: 'rx', type: 'trigger', text: 'race', key: 'race' })));
        expect(results.filter((r: any) => r.delivered)).toHaveLength(1);
        expect((await counts(ctx)).messages).toBe(1);
    });

    test('failure inside the transaction (after hook or event) leaves nothing behind', async () => {
        const ctx = await fixture();
        await expect(ctx.fns.agent.deliver({ to: 'rx', type: 'trigger', text: 'x', key: 'k', after: async () => { throw new Error('injected'); } })).rejects.toThrow('injected');
        expect(await counts(ctx)).toEqual({ messages: 0, events: 0, receipts: 0, wake: null });
        // the same key is still deliverable after the rollback
        expect((await ctx.fns.agent.deliver({ to: 'rx', type: 'trigger', text: 'x', key: 'k' })).delivered).toBe(true);
    });

    test('a false guard writes nothing', async () => {
        const ctx = await fixture();
        const r = await ctx.fns.agent.deliver({ to: 'rx', type: 'trigger', text: 'x', before: async () => false });
        expect(r).toMatchObject({ delivered: false, reason: 'guard' });
        expect(await counts(ctx)).toEqual({ messages: 0, events: 0, receipts: 0, wake: null });
    });

    test('wake policies: keep keeps an earlier schedule, now pulls it in, batch opens a fixed window, none leaves it', async () => {
        const ctx = await fixture();
        const set = (v: number | null) => ctx.fns.procs.db.run({ sql: "UPDATE agents SET next_run_at = ? WHERE id = 'rx'", params: [v] });
        await set(500);
        await ctx.fns.agent.deliver({ to: 'rx', type: 't', text: 'a', now: 1000 });
        expect((await counts(ctx)).wake).toBe(500);
        await set(9000);
        await ctx.fns.agent.deliver({ to: 'rx', type: 't', text: 'b', wake: 'now', now: 1000 });
        expect((await counts(ctx)).wake).toBe(1000);
        await set(null);
        await ctx.fns.agent.deliver({ to: 'rx', type: 't', text: 'c', wake: 'batch', windowMs: 2000, now: 1000 });
        await ctx.fns.agent.deliver({ to: 'rx', type: 't', text: 'd', wake: 'batch', windowMs: 2000, now: 2500 });
        expect((await counts(ctx)).wake).toBe(3000);
        await set(null);
        await ctx.fns.agent.deliver({ to: 'rx', type: 't', text: 'e', wake: 'none', now: 1000 });
        expect((await counts(ctx)).wake).toBeNull();
    });

    test('archived recipient keeps the message but is not woken; unknown recipient throws', async () => {
        const ctx = await fixture();
        expect((await ctx.fns.agent.deliver({ to: 'arch', type: 't', text: 'x' })).delivered).toBe(true);
        expect(await counts(ctx, 'arch')).toMatchObject({ messages: 1, wake: null });
        await expect(ctx.fns.agent.deliver({ to: 'nobody', type: 't', text: 'x' })).rejects.toThrow('unknown agent');
    });
});
