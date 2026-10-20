/** GET /code/tests?kind=fast|it|live|all[&picked=1] — the last run of that kind of tests (code.tests), or of the last picked files, as a page with kind tabs, a Run button and a file picker; the Tests canvas frames it. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request }) {
    const q = new URL(opts.req.url).searchParams.get("kind") ?? "fast";
    const kind = (["fast", "it", "live", "all"].includes(q) ? q : "fast") as types.code.TestKind;
    const picked = new URL(opts.req.url).searchParams.get("picked") === "1";
    const data = await ctx.fns.code.tests({ kind, picked });
    const json = JSON.stringify(data ?? null).replace(/</g, "\\u003c");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Tests</title><script>${THEME}</script><style>${CSS}</style></head>
<body><div id=app></div><script>window.TESTS=${json};window.TEST_KIND=${JSON.stringify(kind)};window.TEST_PICKED=${picked};</script><script src="/code/tests.js"></script></body></html>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

// Same origin as Hyper: the page takes the theme the Hyper page chose (localStorage hyper-theme, else the system),
// and follows a switch — in this tab through the parent's data-theme, in another tab through the storage event.
const THEME = `(()=>{const d=document.documentElement;const pick=()=>{let t=null;try{t=parent!==window&&parent.document.documentElement.dataset.theme}catch(_){}if(t!=='dark'&&t!=='light'){try{t=localStorage.getItem('hyper-theme')}catch(_){}}if(t!=='dark'&&t!=='light')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';d.dataset.theme=t;};pick();addEventListener('storage',pick);try{if(parent!==window)new parent.MutationObserver(pick).observe(parent.document.documentElement,{attributes:true,attributeFilter:['data-theme']})}catch(_){}})()`;

const CSS = `
:root{color-scheme:light;--bg:#fff;--fg:#1f2937;--fg2:#374151;--muted:#6b7280;--faint:#9ca3af;--line:#e5e7eb;--line2:#d1d5db;--soft:#f9fafb;--badbg:#fef2f2;--ink:#111827;--inkfg:#fff;--acc:#2563eb;--accbg:#eff6ff;--accdim:#93c5fd}
/* Dark: the Hyper dark theme (procs/styles/$style_app.css, [data-theme=dark]) in plain values. */
[data-theme=dark]{color-scheme:dark;--bg:oklch(25.33% .016 252.42);--fg:oklch(97.8% .029 256.8);--fg2:oklch(88% .02 256);--muted:#8c959f;--faint:#6e7681;--line:oklch(38% .015 252);--line2:oklch(46% .018 252);--soft:oklch(23.26% .014 253.1);--badbg:color-mix(in oklab,#f85149 14%,transparent);--ink:#f0f6fc;--inkfg:#0d1117;--acc:#388bfd;--accbg:color-mix(in oklab,#388bfd 15%,transparent);--accdim:#1f4b8f}
body{font:13px/1.4 Inter,system-ui,sans-serif;margin:0;padding:16px 20px;color:var(--fg);background:var(--bg)}
h1{font-size:17px;margin:0 0 4px} .sub{color:var(--muted);font-size:12px;margin-bottom:14px}
.kpis{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px}.k{border:1px solid var(--line);border-radius:10px;padding:6px 10px;min-width:70px}.k b{display:block;font-size:20px}.k span{color:var(--muted);font-size:11px}
.k.bad b{color:#dc2626}.k.ok b{color:#16a34a}
h2{font-size:13px;margin:18px 0 8px;color:var(--fg2);text-transform:uppercase;letter-spacing:.04em}
.row{display:grid;grid-template-columns:minmax(0,1fr) 48px;gap:2px 8px;align-items:center;padding:4px 0}.row .name{grid-column:1/3}
.name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,Menlo,monospace;font-size:12px}
.bar{height:12px;border-radius:4px;background:#3b82f6}.bar.hot{background:#f59e0b}.bar.very{background:#ef4444}
.v{text-align:right;font-variant-numeric:tabular-nums;color:var(--fg2)}
.f{border-left:3px solid #ef4444;padding:4px 8px;margin:4px 0;background:var(--badbg);border-radius:4px}
.f .t{font-weight:600}.f .m{color:var(--muted);font-size:12px;font-family:ui-monospace,Menlo,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.grp{color:var(--muted);font-size:12px;margin:8px 0 2px;font-family:ui-monospace,Menlo,monospace}
details>summary{list-style:none;cursor:pointer}details>summary::-webkit-details-marker{display:none}
details[open]>summary .name{color:var(--acc)}
.code{margin:4px 0 10px;border:1px solid var(--line);border-radius:6px;overflow:auto;max-height:420px;font-size:11.5px}
.code pre{margin:0;padding:8px 10px}.code .loc{font:11px ui-monospace,Menlo,monospace;color:var(--muted);padding:4px 10px;border-bottom:1px solid var(--soft);background:var(--soft)}
.sub2{margin-left:12px;border-left:2px solid var(--line);padding-left:8px}.nocode{color:var(--faint);font-size:12px;padding:4px 0}


.bar-top{display:flex;align-items:center;gap:10px;margin-bottom:4px}
.run{margin-left:auto;border:1px solid var(--acc);background:var(--acc);color:#fff;border-radius:8px;padding:5px 14px;font:600 12px Inter,system-ui;cursor:pointer}
.run[disabled]{background:var(--accdim);border-color:var(--accdim);cursor:default}
.status{color:var(--muted);font-size:12px}
.kinds{display:flex;gap:4px;margin:0 0 10px}.kinds a{border:1px solid var(--line);border-radius:8px;padding:4px 10px;color:var(--fg2);text-decoration:none;font-size:12px}
.kinds a.on{background:var(--ink);border-color:var(--ink);color:var(--inkfg)}.kinds a small{color:var(--faint);margin-left:4px}.kinds a.on small{color:var(--line2)}
.empty{color:var(--muted);padding:24px 0}
.rerun{border:1px solid var(--line2);border-radius:6px;padding:1px 7px;background:var(--bg);font:500 11px system-ui;color:var(--fg2);cursor:pointer;margin-left:6px;text-transform:none;letter-spacing:0}
.kinds .sep{flex:1}.kinds button{border:1px solid var(--line);border-radius:8px;padding:4px 10px;background:var(--bg);font-size:12px;cursor:pointer}
.kinds button.on{background:var(--accbg);border-color:var(--accdim)}
#pick{border:1px solid var(--line);border-radius:10px;padding:10px;margin:0 0 12px;display:none}#pick.open{display:block}
#pick .ptools{display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap}
#pick input[type=search]{flex:1;min-width:200px;border:1px solid var(--line2);border-radius:6px;padding:4px 8px;font-size:12px}
#pick .ptools button{border:1px solid var(--line2);border-radius:6px;padding:3px 8px;background:var(--bg);font-size:12px;cursor:pointer}
#pick .ptools .go{background:var(--acc);border-color:var(--acc);color:var(--bg)}#pick .ptools .go:disabled{opacity:.5}
#pick .plist{max-height:320px;overflow:auto;font:12px ui-monospace,monospace}
#pick label{display:grid;grid-template-columns:18px 1fr 60px 60px;gap:6px;padding:2px 4px;border-radius:4px;cursor:pointer}
#pick label:hover{background:var(--soft)}#pick label .fl{color:#dc2626}#pick label .n{color:var(--faint);text-align:right}
body.norun .kpis,body.norun h2,body.norun details{display:none}body.running .empty{display:none}
body.running .kpis,body.running h2,body.running details,body.running .grp,body.running .f{display:none}
#prog:not(:empty){margin:4px 0 14px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--soft)}
.pbar{display:flex;height:14px;border-radius:7px;background:var(--line);overflow:hidden}.pbar i{display:block;height:100%;transition:width .4s}
.pp{background:#22c55e}.pf{background:#ef4444}.ps{background:var(--faint)}
.pnum{margin-top:6px;font-size:12px;color:var(--fg2);font-variant-numeric:tabular-nums}.okc{color:#16a34a}.badc{color:#dc2626}
.pcur{font:11px ui-monospace,Menlo,monospace;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pfl{margin-top:6px;font:11px ui-monospace,Menlo,monospace;color:#b91c1c;max-height:160px;overflow:auto}
`;
