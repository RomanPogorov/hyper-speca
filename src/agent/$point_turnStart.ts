// `agent.turnStart` — a turn of an agent is about to run (after its turn_start mark, before the first model call).
//
// For whatever needs the world as it was before the agent touched it: a snapshot of its workspace folder, so the
// files a turn changed can be shown and put back afterwards. Awaited (a snapshot taken late would miss the turn's
// first write) but never fatal: a rejection is logged and the turn runs.
export default {
    calledWith: "{ agentId: string, turnId: string, dir: string | null, host: string | null } — the agent's workspace folder (and its SSH host, if remote)",
    answerWith: "void — the result is ignored; a rejection is logged",
};
