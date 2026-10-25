// Light/dark switch. The theme itself is applied before first paint by the page head; /dock/dock.js
// flips it on click and paints the icon, so the button keeps working after the Dock is re-rendered.
export default {
    label: "Theme",
    zone: "bottom",
    order: 0,
    render: (ctx: Context) => ctx.fns.procs.ui.button({ action: "toggle-theme", html: '<i class="ph ph-moon" aria-hidden="true"></i>', appearance: "plain", title: "Switch color theme", ariaLabel: "Switch color theme", class: "dock-chip-btn", attrs: { id: "theme-toggle", "aria-pressed": "false" } }),
} satisfies types.dock.Item;
