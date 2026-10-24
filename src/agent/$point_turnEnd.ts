// `agent.turnEnd` — a turn of an agent has ended, whatever its outcome (before its turn_end mark).
//
// The pair of agent.turnStart: what began there is closed here (a workspace snapshot compared with the one taken at
// the start). Awaited, so what it appends to the transcript comes before the turn's end; never fatal.
export default {
    calledWith: "{ agentId: string, turnId: string, dir: string | null, host: string | null, status: 'completed' | 'failed' | 'cancelled' | 'waiting' }",
    answerWith: "void — the result is ignored; a rejection is logged",
};
