export default {
    type: 'number',
    default: 10000,
    min: 1000,
    max: 300000,
    title: 'First retry delay after a transient LLM failure (ms)',
    description: 'Delay before the first automatic re-run after a temporary provider failure; each next attempt waits three times longer (10s, 30s, 90s, 270s with the default), capped at 15 minutes per step.',
};
