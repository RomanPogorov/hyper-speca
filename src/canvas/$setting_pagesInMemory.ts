export default {
    type: 'boolean',
    env: 'CANVAS_PAGES_IN_MEMORY',
    default: true,
    title: 'Static html pages go to memory',
    description: 'A canvas html page without scripts is saved as a memory page (pages/<slug>.html) and opens as a view tab with an address. Off: it stays an html canvas tab with a draft, versions, comparison and comments, like a page with scripts.',
};
