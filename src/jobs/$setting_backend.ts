export default {
    type: "enum",
    options: ["tmux", "hyperd"],
    default: "tmux",
    env: "HYPER_JOBS_BACKEND",
    title: "Background job backend",
    description: "Where local background bash jobs run: tmux sessions (default) or the hyperd process supervisor (survives restarts of this server, PTY, logs by offset). Jobs on SSH hosts always use tmux.",
};
