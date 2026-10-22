// v3: the last two side channels move into jobs.
// - agents.wake_at/wake_reason (legacy single alarm, used by usage-limit parking) → jobs runner 'at';
//   a parking alarm (scratchpad.parked) gets spec.park and its job id in the parking mark.
// - agent_attachments (external event subscriptions) → jobs kind 'subscription', runner 'attach';
//   attachment_deliveries.attachment_id now references jobs(id). Event ids and deliveries stay.
// hyper-code2: `left(x || '', n)` — see 20331022120000_schedules: Postgres 18.2 reports invalid UTF8 when
// left() on a compressed text cuts inside a Cyrillic character; the concatenation detoasts it whole first.
const upSql = `
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agents' AND column_name = 'wake_at') THEN
    EXECUTE $q$
INSERT INTO jobs (id, kind, runner, spec, state, status, owner_id, created_by, agent_id, prompt, execution_id, next_at, created_at, started_at, updated_at)
SELECT 'tr_wake_' || a.id || '_' || a.wake_at, 'schedule', 'at',
       CASE WHEN (a.scratchpad::jsonb)->'parked' IS NOT NULL THEN jsonb_build_object('title', left(COALESCE(a.wake_reason, 'Scheduled wake-up') || '', 120), 'park', true)
            ELSE jsonb_build_object('title', left(COALESCE(a.wake_reason, 'Scheduled wake-up') || '', 120)) END,
       '{}'::jsonb, 'running', a.created_by, 'migration', a.id, 'Wake-up: ' || COALESCE(a.wake_reason, 'Scheduled wake-up'),
       'tr_wake_' || a.id || '_' || a.wake_at, a.wake_at, a.updated_at, a.updated_at, a.updated_at
  FROM agents a WHERE a.wake_at IS NOT NULL AND a.archived_at IS NULL
ON CONFLICT (id) DO NOTHING
    $q$;
    EXECUTE $q$
UPDATE agents SET scratchpad = jsonb_set(scratchpad::jsonb, '{parked,wakeJobId}', to_jsonb('tr_wake_' || id || '_' || wake_at))::text
 WHERE wake_at IS NOT NULL AND archived_at IS NULL AND (scratchpad::jsonb)->'parked' IS NOT NULL
    $q$;
  END IF;
END $$;
ALTER TABLE agents DROP COLUMN IF EXISTS wake_at;
ALTER TABLE agents DROP COLUMN IF EXISTS wake_reason;

-- Re-runnable: the attachment part only runs while the old table still exists.
DO $$ BEGIN
  IF to_regclass('agent_attachments') IS NOT NULL THEN
    EXECUTE $q$
    INSERT INTO jobs (id, kind, runner, spec, state, status, outcome_reason, owner_id, created_by, agent_id, prompt, execution_id, created_at, started_at, finished_at, updated_at)
    SELECT t.id, 'subscription', 'attach',
           jsonb_build_object('title', t.source, 'source', t.source, 'events', t.events, 'filter', t.filter),
           '{}'::jsonb,
           CASE WHEN t.status = 'detached' THEN 'cancelled' ELSE 'running' END,
           CASE WHEN t.status = 'detached' THEN 'detached' ELSE NULL END,
           a.created_by, 'migration', t.agent_id, t.prompt, t.id, t.created_at, t.created_at, t.detached_at, t.updated_at
      FROM agent_attachments t JOIN agents a ON a.id = t.agent_id
    ON CONFLICT (id) DO NOTHING
    $q$;
    ALTER TABLE attachment_deliveries DROP CONSTRAINT IF EXISTS attachment_deliveries_attachment_id_fkey;
    DROP TABLE agent_attachments;
  END IF;
END $$;
ALTER TABLE attachment_deliveries DROP CONSTRAINT IF EXISTS attachment_deliveries_attachment_id_fkey;
DELETE FROM attachment_deliveries d WHERE NOT EXISTS (SELECT 1 FROM jobs j WHERE j.id = d.attachment_id);
ALTER TABLE attachment_deliveries ADD CONSTRAINT attachment_deliveries_attachment_id_fkey FOREIGN KEY (attachment_id) REFERENCES jobs(id) ON DELETE CASCADE;
`;

export default {
    up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: upSql }); },
    // Structure only; the moved rows stay in jobs.
    down: async (ctx: Context) => {
        await ctx.fns.procs.db.exec({ sql: `
ALTER TABLE agents ADD COLUMN IF NOT EXISTS wake_at BIGINT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS wake_reason TEXT;
CREATE TABLE IF NOT EXISTS agent_attachments (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE, source TEXT NOT NULL,
  events JSONB NOT NULL DEFAULT '[]'::jsonb, filter JSONB NOT NULL DEFAULT '{}'::jsonb, prompt TEXT, status TEXT NOT NULL DEFAULT 'active',
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, detached_at BIGINT);
ALTER TABLE attachment_deliveries DROP CONSTRAINT IF EXISTS attachment_deliveries_attachment_id_fkey;` });
    },
};
