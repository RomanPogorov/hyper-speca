// How risky a Hyper tool call is, in Speca's four classes: read (nothing changes), own_write (the chat's own folder,
// canvases and drafts), external (outside the workspace: this computer's shell, other servers, services) and
// irreversible (cannot be taken back: confirmed also with full access). Speca's core/util/shell.ts for commands, its
// tool-name verbs for functions; `eval` is read by the ctx.fns.* it calls.
export type Effect = "read" | "own_write" | "external" | "irreversible";
const RANK: Record<Effect, number> = { read: 0, own_write: 1, external: 2, irreversible: 3 };
export const strongest = (xs: Effect[], none: Effect = "read"): Effect => xs.reduce<Effect>((a, b) => (RANK[b] > RANK[a] ? b : a), xs.length ? "read" : none);

// ── commands (Speca core/util/shell.ts) ──────────────────────────────────
const DESTRUCTIVE_ANYWHERE = /(git\s+push\b[^;&|\n]*\s(--force|-[a-z]*f[a-z]*\b|\+[\w/.-]+)|git\s+reset\s+--hard|git\s+clean\s+-[a-z]*f|git\s+branch\s+-D|\bdrop\s+(table|database|schema)\b|\btruncate\s+table\b|\bmkfs|\bdd\s+if=|:\(\)\s*\{)/i;
const POWER_OFF = /(?:^|[;&|(`\n]|\$\()\s*(?:sudo\s+(?:-\S+\s+)*)?(?:\/\S*\/)?(?:shutdown|reboot|halt|poweroff)\b/i;
const HEREDOC = /<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g;
const withoutHeredocs = (c: string) => c.replace(HEREDOC, "<<$2");
const withoutFileText = (c: string) => c.replace(HEREDOC, (m, _q: string, tag: string, at: number) =>
  /(?:^|[;&|(\n])\s*(?:sudo\s+)?(?:cat|tee)\b[^;&|\n]*$/.test(c.slice(0, at)) ? `<<${tag}` : m);

const BUILD = new Set(["node_modules", "dist", "build", "out", ".next", ".nuxt", ".turbo", ".cache", ".parcel-cache", "coverage", "target", "tmp", ".tmp", "__pycache__", ".pytest_cache", ".svelte-kit", ".vite"]);
const unq = (t: string) => t.replace(/^(['"])(.*)\1$/, "$2");
const TMP = /^(?:\/private)?\/tmp\/[^/]|^\/var\/folders\/[^/]+\/[^/]+\/T\/[^/]|^\$\{?TMPDIR\}?\/[^/]/;
function throwaway(t: string, inTmp: boolean): boolean {
  if (!t || t.includes("..")) return false;
  if (TMP.test(t)) return true;
  if (/^[/~$]/.test(t)) return false;
  if (inTmp) return !/^[.*]$|^\.\/?$/.test(t);
  if (/[*?]/.test(t)) return false;
  const last = t.replace(/\/+$/, "").split("/").pop() ?? "";
  return BUILD.has(last);
}
function removesFolders(c: string): boolean {
  let inTmp = false;
  for (const raw of c.split(/&&|\|\||[;\n|]/)) {
    const seg = raw.trim().replace(/^[({\s]+/, "").replace(/^sudo\s+(?:-\S+\s+)*/, "");
    const cd = /^cd\s+(\S+)/.exec(seg);
    if (cd) { const d = unq(cd[1]!); inTmp = /^[/~$]/.test(d) ? TMP.test(`${d.replace(/\/$/, "")}/x`) : inTmp && !d.includes(".."); continue; }
    const rm = /^(?:\/bin\/)?rm\s+(.*)$/.exec(seg);
    if (!rm) continue;
    const toks = rm[1]!.split(/\s+/).filter(Boolean);
    const flags = toks.filter((x) => x.startsWith("-")).join(" ");
    const targets = toks.filter((x) => !x.startsWith("-")).map(unq);
    const recursive = /(^|\s)-[a-zA-Z]*[rR]|--recursive/.test(flags), force = /(^|\s)-[a-zA-Z]*f|--force/.test(flags);
    if (!recursive || !(force || targets.some((x) => x.startsWith("/")))) continue;
    if (!targets.length || targets.some((x) => !throwaway(x, inTmp))) return true;
  }
  return false;
}
export const destructive = (c: string) => { const run = withoutFileText(c); return DESTRUCTIVE_ANYWHERE.test(run) || removesFolders(run) || POWER_OFF.test(withoutHeredocs(c)); };

const READERS = new Set(["ls", "cat", "head", "tail", "wc", "grep", "rg", "egrep", "fgrep", "pwd", "which", "whoami", "echo", "date", "uname", "env", "printenv", "ps", "df", "du", "file", "stat", "tree", "less", "more", "sort", "uniq", "cut", "tr", "diff", "jq", "hostname", "uptime", "id", "basename", "dirname", "realpath", "readlink", "type", "true", "column", "nl", "md5", "md5sum", "shasum", "sha256sum"]);
const GIT_READERS = new Set(["status", "log", "diff", "show", "blame", "rev-parse", "ls-files", "remote", "describe", "shortlog"]);
const VERSION = /^[\w.+-]+\s+(--version|-v|-V|version)$/;
/** A plain reading command: reading programs joined by pipes, nothing written, nothing chained. */
export function readsOnly(cmd: string): boolean {
  const c = cmd.trim().replace(/^cd\s+\S+\s*&&\s*/, "");
  if (!c || /[;&`>\n]|\$\(|<\(|\|\|/.test(c)) return false;
  return c.split("|").every((seg) => {
    const s = seg.trim();
    if (VERSION.test(s)) return true;
    const [prog, sub, ...rest] = s.split(/\s+/);
    if (!prog || /=/.test(prog)) return false;
    if (prog === "git") return !!sub && GIT_READERS.has(sub) && !(sub === "remote" && rest.some((r) => !r.startsWith("-")));
    if (prog === "find") return !/\s-(exec|execdir|ok|delete|fprint\w*)\b/.test(s);
    if (prog === "sed") return !/\s-[a-zA-Z]*i/.test(s);
    return READERS.has(prog);
  });
}
export const commandEffect = (cmd: string): Effect => destructive(cmd) ? "irreversible" : readsOnly(cmd) ? "read" : "external";

// ── functions (eval) ───────────────────────────────────────────────────
const READ_VERBS = new Set(["search", "get", "list", "read", "find", "fetch", "query", "suggest", "lookup", "describe", "export", "guide", "view", "select", "tab", "tabs", "status", "logs", "help", "docs", "schema", "info", "exists", "history", "diff", "changes", "servers", "count", "peek", "load", "outline", "screenshot", "shot", "render", "preview", "check", "validate", "parse"]);
const WRITE_VERBS = new Set(["send", "create", "update", "delete", "trash", "remove", "post", "schedule", "apply", "label", "unlabel", "mark", "unmark", "forward", "reply", "respond", "draft", "move", "add", "set", "upload", "share", "invite", "untrash", "edit", "write", "publish", "push", "merge", "deploy", "pay", "transfer", "run", "start", "stop", "restart", "reload", "install"]);
/** Modules whose changes stay in the workspace: the chat, its canvases, its folder, its jobs and notes. */
const OWN = new Set(["canvas", "speca", "agent", "session", "notes", "jobs", "tools", "ui", "files", "plan", "team", "memory", "scratchpad", "design", "board", "excalidraw", "tldraw", "terminal", "proto", "events"]);
const words = (name: string) => name.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase().split(/[_\-.\s]+/).filter(Boolean);

/** Functions that only talk to the person or read, whatever their names say. */
const READ_FNS = new Set(["speca.planPropose", "speca.askUser", "speca.protoChanges", "speca.designGuide", "speca.designRead", "agent.current", "canvas.notify"]);

/** The effect of one ctx.fns.<module>.<fn> by its name. */
export function fnEffect(name: string, code = ""): Effect {
  if (READ_FNS.has(name)) return "read";
  const [mod = "", ...rest] = name.split(".");
  const w = words(rest.join("."));
  if (mod === "procs") {
    if (rest[0] === "db") {
      if (/\b(drop\s+(table|database|schema)|truncate(\s+table)?|delete\s+from)\b/i.test(code)) return "irreversible";
      return rest[1] === "select" && !/\b(insert|update|alter|create)\b/i.test(code) ? "read" : "own_write";
    }
    return w.some((x) => READ_VERBS.has(x)) ? "read" : "own_write";
  }
  if (w.includes("delete") || w.includes("destroy") || w.includes("drop") || w.includes("purge")) return OWN.has(mod) ? "own_write" : "irreversible";
  const reads = w.some((x) => READ_VERBS.has(x)), writes = w.some((x) => WRITE_VERBS.has(x));
  if (reads && !writes) return "read";
  if (OWN.has(mod)) return "own_write";
  return writes ? "external" : reads ? "read" : "external";
}
const FNS = /\bfns\s*\.\s*([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)/g;
/** The ctx.fns.* a piece of code calls, as "module.fn". */
export const fnsIn = (code: string): string[] => [...new Set([...code.matchAll(FNS)].map((m) => `${m[1]}.${m[2]!.replace(/\s+/g, "")}`))];

export function evalEffect(code: string): Effect {
  const fs = fnsIn(code);
  const own: Effect[] = [];
  // code that writes or runs by itself, not through ctx.fns
  if (/\$`|\bspawn(Sync)?\s*\(|\bexecSync\s*\(|\bBun\.spawn/.test(code)) own.push(destructive(code) ? "irreversible" : "external");
  if (/\bfetch\s*\(/.test(code) && /method\s*:\s*['"`](POST|PUT|PATCH|DELETE)/i.test(code)) own.push("external");
  if (/\bBun\.write\s*\(|\bwriteFile(Sync)?\s*\(|\bappendFile(Sync)?\s*\(|\bmkdir(Sync)?\s*\(/.test(code)) own.push("own_write");
  if (/\b(unlink|rm|rmdir)(Sync)?\s*\(/.test(code)) own.push(/recursive\s*:\s*true/.test(code) ? "irreversible" : "own_write");
  return strongest([...own, ...fs.map((f) => fnEffect(f, code))]);
}

// ── one tool call ──────────────────────────────────────────────────────
export type Call = { effect: Effect; summary: string; items: string[]; plugin: string | null; why: string | null };
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const lines = (s: string, n: number) => { const ls = s.split("\n"); return ls.length > n ? [...ls.slice(0, n), `… (${ls.length - n} more lines)`] : ls; };

/** What a call does and how risky it is, with what the card shows. `remote`: the host is not the chat's own. */
export function classify(tool: string, args: Record<string, any>, t: (k: string, v?: Record<string, unknown>) => string): Call {
  const host = typeof args.host === "string" && args.host && args.host !== "local" ? String(args.host) : null;
  const why = typeof args.why === "string" ? cut(args.why, 400) : typeof args.description === "string" && tool === "bash" ? cut(args.description, 400) : null;
  switch (tool) {
    case "read": case "find": case "grep": case "respondHtml":
      return { effect: "read", summary: tool, items: [], plugin: host, why };
    case "write": case "edit": {
      const path = String(args.path ?? "");
      const n = Array.isArray(args.edits) ? args.edits.length : 0;
      return {
        effect: host ? "external" : "own_write", plugin: host, why,
        summary: tool === "write" ? t("appr.s.write", { path }) : t("appr.s.edit", { path, n }),
        items: tool === "write" ? lines(cut(String(args.content ?? ""), 1500), 12)
          : (args.edits ?? []).slice(0, 6).map((e: any) => cut(e?.oldText != null
            ? `${String(e.oldText).split("\n")[0]} → ${String(e.newText ?? "").split("\n")[0] || "∅"}`
            : `${e?.op ?? "edit"} ${e?.anchor ?? ""}: ${String(e?.text ?? "").split("\n")[0]}`, 160)),
      };
    }
    case "bash": {
      const cmd = String(args.command ?? "").trim();
      return { effect: commandEffect(cmd), plugin: host, why, summary: t(host ? "appr.s.bashOn" : "appr.s.bash", { host: host ?? "" }), items: lines(cut(cmd, 3000), 20).map((l, i) => (i === 0 ? `$ ${l}` : l)) };
    }
    case "eval": {
      const code = String(args.code ?? "");
      const fs = fnsIn(code);
      return { effect: evalEffect(code), plugin: null, why, summary: fs.length ? t("appr.s.evalFns", { fns: fs.slice(0, 5).join(", ") + (fs.length > 5 ? "…" : "") }) : t("appr.s.eval"), items: lines(cut(code, 3000), 20) };
    }
    default: {
      const w = words(tool);
      const effect: Effect = w.includes("delete") ? "irreversible" : w.some((x) => WRITE_VERBS.has(x)) ? "external" : w.some((x) => READ_VERBS.has(x)) ? "read" : "external";
      return { effect, plugin: null, why, summary: tool, items: [cut(JSON.stringify(args), 600)] };
    }
  }
}
