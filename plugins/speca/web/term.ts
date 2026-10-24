// Speca's terminal (plugins/servers: terminal.canvas.ts, lib/term.ts, lib/view.ts) on Hyper: the person's own shell,
// live in a canvas tab (speca.terminal) and on a full-screen page (/speca/term?s=…, e.g. a phone). For the person
// only — agents run commands with remote.exec / bash. Places: "@mac" — this computer (Hyper runs on it, so its own
// login shell), and every server of Hyper's (remote.servers: the Host aliases of ~/.ssh/config), reached with the
// person's own `ssh` (their keys, known_hosts, config). One live shell per person and place, in a real terminal
// (Bun's PTY): the tab and the phone page are windows into the same session; it survives a dropped connection (its
// recent output is replayed on reattach) and ends by itself when nobody has watched it for a while.
import { homedir } from "node:os";
import { html, join, raw, type Raw } from "./html.ts";
import { ic } from "./ui/icons.ts";

export const MAC = "@mac";

export type TermEvent = { type: "data"; data: string } | { type: "status"; state: "connecting" | "open" | "closed"; message?: string };
type Listener = (ev: TermEvent) => void;
type Sess = {
  key: string; owner: string; place: string; started: number;
  proc: any; state: "connecting" | "open" | "closed"; message?: string;
  out: Buffer[]; outBytes: number; listeners: Set<Listener>; idle: ReturnType<typeof setTimeout> | null;
};

// kept on globalThis: a plugin module may be loaded twice (route and canvas bundles) and a reload must not lose shells
const sessions: Map<string, Sess> = ((globalThis as any).__specaTerm ??= new Map());
const KEEP = 256 * 1024;
const IDLE_MS = 30 * 60_000;
const MAX_AGE_MS = 12 * 3_600_000;
const MAX_PER_PERSON = 6;
const keyOf = (owner: string, place: string) => `${owner}\u0000${place}`;

/** The places of the terminal: this computer and Hyper's SSH servers. */
export async function places(h: { fns: any }): Promise<Array<{ name: string; where: string }>> {
  const list = ((await h.fns.remote.servers({}).catch(() => [])) as Array<{ name: string; hostname: string; user: string; port: number }>);
  return list.map((s) => ({ name: s.name, where: `${s.user ? `${s.user}@` : ""}${s.hostname}${s.port && s.port !== 22 ? `:${s.port}` : ""}` }));
}
export async function knownPlace(h: { fns: any }, place: string): Promise<boolean> {
  return place === MAC || (await places(h)).some((p) => p.name === place);
}

/** Only the instance's owner gets a shell (an instance without users: whoever is signed in, i.e. the local person). */
export async function mayUse(h: { fns: any }, userId: string): Promise<boolean> {
  const owner = await h.fns.auth?.ownerId?.({}).catch(() => null);
  return !owner || owner === userId;
}

function emit(s: Sess, ev: TermEvent) { for (const l of s.listeners) { try { l(ev); } catch { /* a closed stream */ } } }
function setState(s: Sess, state: Sess["state"], message?: string) { s.state = state; s.message = message; emit(s, { type: "status", state, message }); }
function end(s: Sess, why: string) {
  if (sessions.get(s.key) !== s) return;
  sessions.delete(s.key);
  if (s.idle) clearTimeout(s.idle);
  try { s.proc?.kill(); } catch { /* gone */ }
  setState(s, "closed", why);
}

async function open(h: { fns: any }, owner: string, place: string, size: { cols: number; rows: number }): Promise<Sess> {
  const s: Sess = { key: keyOf(owner, place), owner, place, started: Date.now(), proc: null, state: "connecting", out: [], outBytes: 0, listeners: new Set(), idle: null };
  sessions.set(s.key, s);
  const push = (b: Uint8Array) => {
    const buf = Buffer.from(b);
    s.out.push(buf); s.outBytes += buf.length;
    while (s.outBytes > KEEP && s.out.length > 1) s.outBytes -= s.out.shift()!.length;
    if (s.state === "connecting") setState(s, "open");
    emit(s, { type: "data", data: buf.toString("base64") });
  };
  let cmd: string[];
  if (place === MAC) cmd = [process.env.SHELL || "/bin/zsh", "-l"];
  else {
    const { bin } = await h.fns.remote.sshOptions({ persist: false });
    const custom = String(process.env.HYPER_SSH_CONFIG ?? "").trim();
    cmd = [bin, ...(custom ? ["-F", custom] : []), "-tt", "-o", "ServerAliveInterval=15", "-o", "ConnectTimeout=15", place];
  }
  const env = { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", LANG: process.env.LANG || "en_US.UTF-8" } as Record<string, string>;
  try {
    s.proc = Bun.spawn(cmd, { cwd: homedir(), env, terminal: { cols: size.cols, rows: size.rows, data: (_t: unknown, d: Uint8Array) => push(d) } } as any);
  } catch (e: any) {
    end(s, String(e?.message ?? e));
    return s;
  }
  s.proc.exited.then((code: number) => end(s, code === 255 && place !== MAC ? "ssh_failed" : "exit"));
  // a shell that prints nothing yet is still a shell: open after a moment
  setTimeout(() => { if (s.state === "connecting" && sessions.get(s.key) === s && place === MAC) setState(s, "open"); }, 800);
  setTimeout(() => { if (sessions.get(s.key) === s) end(s, "max_age"); }, MAX_AGE_MS).unref?.();
  return s;
}

/** Watch (and, if needed, start) the person's session on a place. Returns a function that stops watching. */
export async function attach(h: { fns: any }, o: { owner: string; place: string; size: { cols: number; rows: number }; listener: Listener }): Promise<() => void> {
  let s = sessions.get(keyOf(o.owner, o.place));
  if (!s || s.state === "closed") {
    const mine = [...sessions.values()].filter((x) => x.owner === o.owner).length;
    if (mine >= MAX_PER_PERSON) { o.listener({ type: "status", state: "closed", message: "too_many" }); return () => {}; }
    s = await open(h, o.owner, o.place, o.size);
  }
  const sess = s;
  if (sess.idle) { clearTimeout(sess.idle); sess.idle = null; }
  sess.listeners.add(o.listener);
  if (sess.out.length) o.listener({ type: "data", data: Buffer.concat(sess.out).toString("base64") });
  o.listener({ type: "status", state: sess.state, message: sess.message });
  return () => {
    sess.listeners.delete(o.listener);
    if (!sess.listeners.size && sess.state !== "closed") sess.idle = setTimeout(() => end(sess, "idle"), IDLE_MS);
  };
}

export function write(owner: string, place: string, data: string): boolean {
  const s = sessions.get(keyOf(owner, place));
  if (!s?.proc?.terminal || s.state === "closed") return false;
  s.proc.terminal.write(data);
  return true;
}
export function resize(owner: string, place: string, cols: number, rows: number) {
  try { sessions.get(keyOf(owner, place))?.proc?.terminal?.resize(cols, rows); } catch { /* gone */ }
}
export function close(owner: string, place: string): boolean {
  const s = sessions.get(keyOf(owner, place));
  if (!s) return false;
  end(s, "closed_by_person");
  return true;
}

// ---------- view ----------
export const T = (locale: string) => {
  const ru = locale === "ru";
  return {
    connecting: ru ? "Подключаюсь…" : "Connecting…",
    closed: ru ? "Сессия закрыта" : "Session closed",
    reconnect: ru ? "Подключиться снова" : "Connect again",
    end: ru ? "Завершить сессию" : "End the session",
    endAsk: ru ? "Завершить SSH-сессию? Запущенные в ней программы остановятся." : "End the SSH session? Programs running in it will stop.",
    full: ru ? "Открыть на весь экран (удобно с телефона)" : "Open full screen (handy on a phone)",
    pick: ru ? "Где открыть терминал" : "Where to open the terminal",
    none: ru ? "Серверов пока нет: Hyper берёт их из ~/.ssh/config (строки Host). Можно открыть терминал этого компьютера." : "No servers yet: Hyper takes them from ~/.ssh/config (Host lines). This computer's terminal is available.",
    paste: ru ? "Вставить" : "Paste",
    title: ru ? "Терминал" : "Terminal",
    mac: ru ? "Этот компьютер" : "This computer",
    macWhere: ru ? "где запущен Hyper, ваш шелл" : "where Hyper runs, your shell",
    endAskMac: ru ? "Закрыть терминал этого компьютера? Запущенные в нём программы остановятся." : "Close this computer's terminal? Programs running in it will stop.",
    will: ru ? "Выполнится:" : "Will run:",
    why: {
      idle: ru ? "Закрыта: долго никто не смотрел." : "Closed: nobody watched it for a while.",
      too_many: ru ? "Слишком много открытых сессий — завершите одну из них." : "Too many open sessions — end one of them.",
      exit: ru ? "Шелл завершился." : "The shell exited.",
      ssh_failed: ru ? "SSH не подключился (ключ, адрес или сервер недоступен) — подробности выше." : "SSH did not connect (key, address or the server is down) — details above.",
      closed_by_person: ru ? "Вы завершили сессию." : "You ended the session.",
      max_age: ru ? "Закрыта: сессия шла 12 часов." : "Closed after 12 hours.",
      not_yours: ru ? "Нет такого места среди ваших." : "No such place of yours.",
    } as Record<string, string>,
  };
};

const KEYS: Array<[string, string]> = [["esc", "Esc"], ["tab", "Tab"], ["ctrl", "Ctrl"], ["up", "↑"], ["down", "↓"], ["left", "←"], ["right", "→"], ["c-c", "^C"], ["c-d", "^D"], ["|", "|"], ["~", "~"], ["/", "/"], ["-", "-"], ["paste", ""]];

/** The terminal's markup, shared by the canvas tab and the full-screen page; assets/term/term.js brings it to life. */
export async function termView(h: { fns: any }, locale: string, place: string, o: { tab?: number | null; full?: boolean }): Promise<Raw> {
  const t = T(locale);
  const list = await places(h);
  const mac = place === MAC, known = mac || list.some((x) => x.name === place);
  const keys = KEYS.map(([k, label]) => html`<button type="button" class="sterm-key" data-key="${k}"${k === "ctrl" ? raw(` aria-pressed="false"`) : ""}>${k === "paste" ? t.paste : label}</button>`);
  const i18n = raw(JSON.stringify({ connecting: t.connecting, closed: t.closed, why: t.why }).replace(/</g, "\\u003c"));
  return html`<div class="sterm${o.full ? " sterm-full" : ""}" data-server="${known ? place : ""}" data-tab="${o.tab ?? ""}" data-mac-name="${t.mac}">
    <div class="sterm-bar">
      <span class="sterm-dot" aria-hidden="true"></span>
      <span class="sterm-name">${mac ? t.mac : known ? place : t.title}</span>
      <span class="sterm-state" role="status"></span>
      <span class="sterm-grow"></span>
      ${o.full ? "" : html`<a class="sterm-btn" data-act="full" href="/speca/term?s=${encodeURIComponent(place)}" target="_blank" rel="noopener" aria-label="${t.full}" title="${t.full}"${known ? "" : raw(" hidden")}>${ic("arrowUR", "ic-sm")}</a>`}
      <button type="button" class="sterm-btn" data-act="end" aria-label="${t.end}" title="${t.end}" data-ask="${t.endAsk}" data-ask-mac="${t.endAskMac}"${known ? "" : raw(" hidden")}>${ic("x", "ic-sm")}</button>
    </div>
    <div class="sterm-pick"${known ? raw(" hidden") : ""}>
      <p class="sterm-will" hidden><span>${t.will}</span> <b></b></p>
      <p>${list.length ? t.pick : t.none}</p>
      <button type="button" class="sterm-srv sterm-mac" data-pick="${MAC}"><b>${t.mac}</b><span>${t.macWhere}</span></button>
      ${join(list.map((x) => html`<button type="button" class="sterm-srv" data-pick="${x.name}"><b>${x.name}</b><span>${x.where}</span></button>`))}
    </div>
    <div class="sterm-screen"${known ? "" : raw(" hidden")}></div>
    <div class="sterm-over" hidden><p class="sterm-msg"></p><button type="button" class="sterm-again">${t.reconnect}</button></div>
    <div class="sterm-keys"${known ? "" : raw(" hidden")}>${keys}</div>
    <script type="application/json" class="sterm-i18n">${i18n}</script>
  </div>`;
}

export const TERM_ASSETS = raw(`<link rel="stylesheet" href="/speca/assets/term/xterm.css"><link rel="stylesheet" href="/speca/assets/term/term.css"><script src="/speca/assets/term/term.js"></script>`);
