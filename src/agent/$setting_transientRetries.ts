export default {
    type: 'number',
    default: 4,
    min: 0,
    max: 10,
    title: 'Automatic retries after a transient LLM failure',
    description: 'How many times workerLoop re-runs an agent after a temporary provider failure (overloaded, 5xx, dropped or stalled stream, 429 throttling) before leaving the error to the person. Delays grow as transientRetryBaseMs × 3^n and never undercut the provider Retry-After. 0 disables automatic retries.',
};
