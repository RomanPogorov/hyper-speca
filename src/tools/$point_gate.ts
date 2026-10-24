// A tool call an agent is about to make, after its arguments were found valid
// and before it runs. The first hook that answers decides (hooks.first): a UI
// that asks the person before changes (a confirmation card, autonomy levels)
// answers here; nobody answering lets the call run as before.
export default {
    calledWith: "{ agentId: string, tool: string, args: any, signal: AbortSignal } — the tool's wire name and its validated arguments; the signal aborts when the call or the agent is stopped",
    answerWith: "null to let the call run, or { deny: string } — the call is not run and the model sees that text as the tool's error. A hook may wait (for a person's decision) before it answers",
};
