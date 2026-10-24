// Speca's design ↔ prototype link: an html tab built from a design canvas remembers it (speca_links). Each side's
// fingerprint at the last sync tells whether the design changed since (the prototype is "behind") or the prototype
// changed since (it is "ahead": the design lacks it); both states as they were then let the agent read exactly what
// changed (speca.protoChanges). The buttons on either tab ask the agent as the person (route canvas/:tab/prototype).
import { diffBoard, type Change } from "./design/diff.ts";
import { unified } from "./diff.ts";

type H = { fns: any };
type TabLike = { id: number; agentId: string; kind: string; title: string; args: Record<string, any>; closedAt?: number | null };
export type Dir = "build" | "forward" | "back";
export type LinkRow = { built_id: number; source_id: number; agent_id: string; source_key: string | null; built_key: string | null; source_base: any; built_base: any; sync_dir: Dir | null; sync_at: number | null; synced_at: number | null };
export type Link = { built: TabLike; source: TabLike; behind: boolean; ahead: boolean; dir: Dir | null };

const sel = async <R = any>(h: H, sql: string, params: unknown[] = []): Promise<R[]> => (await h.fns.procs.db.select({ sql, params })) as R[];
const exec = (h: H, sql: string, params: unknown[] = []) => h.fns.procs.db.run({ sql, params });

/** Kinds a prototype can be built from (Speca: the kind's `prototype` option). */
export const DESIGN_KINDS = new Set(["speca.design"]);
/** What of a tab its link follows: a design's artboards themselves (not stickies, comments or where boards sit); an
 *  html page's html; anything else, its args. */
export function partOf(t: Pick<TabLike, "kind" | "args">): unknown {
  if (DESIGN_KINDS.has(t.kind)) return t.args?.files ?? {};
  if (t.kind === "html") return String(t.args?.html ?? "");
  return t.args ?? {};
}
export const keyOf = (t: Pick<TabLike, "kind" | "args">) => Bun.hash(JSON.stringify(partOf(t) ?? null)).toString(36);

const tabOf = async (h: H, id: number): Promise<TabLike | null> => (await h.fns.canvas.tab({ itemId: id }).catch(() => null)) as TabLike | null;
const stateOf = (r: LinkRow, built: TabLike, source: TabLike): Link => ({
  built, source, dir: r.sync_dir,
  behind: r.source_key !== keyOf(source),
  ahead: !!r.built_key && r.built_key !== keyOf(built),
});

/** Link a built tab to its source, as in step now (both fingerprints and states are the base). */
export async function link(h: H, builtId: number, sourceId: number): Promise<void> {
  const built = await tabOf(h, builtId), source = await tabOf(h, sourceId);
  if (!built || !source) throw new Error("no such tab");
  if (built.id === source.id) throw new Error("a tab cannot be built from itself");
  if (built.agentId !== source.agentId) throw new Error("both tabs must be in the same chat");
  await exec(h, `INSERT INTO speca_links (built_id, source_id, agent_id, source_key, built_key, source_base, built_base, synced_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?)
    ON CONFLICT (built_id) DO UPDATE SET source_id = EXCLUDED.source_id, source_key = EXCLUDED.source_key, built_key = EXCLUDED.built_key,
      source_base = EXCLUDED.source_base, built_base = EXCLUDED.built_base, synced_at = EXCLUDED.synced_at, sync_dir = NULL, sync_at = NULL`,
    [built.id, source.id, built.agentId, keyOf(source), keyOf(built), JSON.stringify(partOf(source)), JSON.stringify(partOf(built)), Date.now(), Date.now()]);
  // the source's own "being built" mark ends: the prototype exists now
  await exec(h, `DELETE FROM speca_links WHERE built_id = ? AND source_id = ?`, [-source.id, source.id]);
}

/** Open tabs built from this one, newest first, with the state of each link. */
export async function builtFrom(h: H, sourceId: number): Promise<Link[]> {
  const rows = await sel<LinkRow>(h, `SELECT * FROM speca_links WHERE source_id = ? AND built_id > 0 ORDER BY created_at DESC`, [sourceId]);
  if (!rows.length) return [];
  const source = await tabOf(h, sourceId);
  if (!source) return [];
  const out: Link[] = [];
  for (const r of rows) {
    const built = await tabOf(h, Number(r.built_id));
    if (built && !built.closedAt) out.push(stateOf(r, built, source));
  }
  return out;
}

/** The tab this one was built from, while it is open, with the state of the link. */
export async function sourceOf(h: H, tab: TabLike): Promise<Link | null> {
  const [r] = await sel<LinkRow>(h, `SELECT * FROM speca_links WHERE built_id = ?`, [tab.id]);
  if (!r) return null;
  const source = await tabOf(h, Number(r.source_id));
  return source && !source.closedAt ? stateOf(r, tab, source) : null;
}

/** The link of a tab, either side: its own (a prototype) or its newest prototype's (a design). */
async function rowFor(h: H, tabId: number): Promise<LinkRow | null> {
  const [own] = await sel<LinkRow>(h, `SELECT * FROM speca_links WHERE built_id = ?`, [tabId]);
  if (own) return own;
  const [b] = await builtFrom(h, tabId);
  if (!b) return null;
  return (await sel<LinkRow>(h, `SELECT * FROM speca_links WHERE built_id = ?`, [b.built.id]))[0] ?? null;
}

/** Both sides match as of now (after either was brought up to date with the other). `tabId`: either side. */
export async function markSynced(h: H, tabId: number): Promise<{ built: number; source: number } | null> {
  const r = await rowFor(h, tabId);
  if (!r) return null;
  const built = await tabOf(h, Number(r.built_id)), source = await tabOf(h, Number(r.source_id));
  if (!built || !source) return null;
  await exec(h, `UPDATE speca_links SET source_key = ?, built_key = ?, source_base = ?::jsonb, built_base = ?::jsonb, synced_at = ?, sync_dir = NULL, sync_at = NULL WHERE built_id = ?`,
    [keyOf(source), keyOf(built), JSON.stringify(partOf(source)), JSON.stringify(partOf(built)), Date.now(), built.id]);
  return { built: built.id, source: source.id };
}

/** The person asked the agent for a sync one way: the tabs say "the agent is on it" until it is done (or the
 *  agent's answer ends). "build" has no prototype yet — kept as a row of its own (built_id = −source). */
export async function startSync(h: H, tab: TabLike, dir: Dir): Promise<void> {
  if (dir === "build") {
    await exec(h, `INSERT INTO speca_links (built_id, source_id, agent_id, sync_dir, sync_at, created_at) VALUES (?, ?, ?, 'build', ?, ?)
      ON CONFLICT (built_id) DO UPDATE SET sync_dir = 'build', sync_at = EXCLUDED.sync_at`, [-tab.id, tab.id, tab.agentId, Date.now(), Date.now()]);
    return;
  }
  const r = await rowFor(h, tab.id);
  if (r) await exec(h, `UPDATE speca_links SET sync_dir = ?, sync_at = ? WHERE built_id = ?`, [dir, Date.now(), r.built_id]);
}
/** A design being built into its first prototype right now. */
export async function building(h: H, sourceId: number): Promise<boolean> {
  return (await sel(h, `SELECT 1 FROM speca_links WHERE built_id = ? AND sync_dir = 'build'`, [-sourceId])).length > 0;
}
/** The agent's answer ended: whatever sync it was asked for is over (done, or the buttons show again). */
export async function endSyncs(h: H, agentId: string): Promise<void> {
  await exec(h, `DELETE FROM speca_links WHERE agent_id = ? AND built_id < 0`, [agentId]);
  await exec(h, `UPDATE speca_links SET sync_dir = NULL, sync_at = NULL WHERE agent_id = ? AND sync_dir IS NOT NULL`, [agentId]);
}

const say = (c: Change): string => {
  switch (c.kind) {
    case "text": return `text of <${c.tag}>: "${c.before}" → "${c.after}"`;
    case "style": return `style of <${c.tag}>: ${c.props.map((p) => `${p.prop} ${p.before ?? "—"} → ${p.after ?? "—"}`).join("; ")}`;
    case "class": return `class of <${c.tag}>: "${c.before}" → "${c.after}"`;
    case "image": return `picture in <${c.tag}> replaced`;
    case "link": return `link of <${c.tag}>: ${c.before} → ${c.after}`;
    case "css": return "the <style> block changed";
    default: return `${c.kind} <${c.tag}>${c.text ? ` "${c.text}"` : ""}`;
  }
};

/** What changed on one side since the last sync, for the agent: a design — artboards added, removed and changed (with
 *  what changed in each); an html page — a unified diff. `tabId`: the side to read. */
export async function changesSince(h: H, tabId: number): Promise<string> {
  const r = await rowFor(h, tabId);
  if (!r) return `Tab ${tabId} is not linked to a design or a prototype.`;
  const builtSide = Number(r.built_id) === tabId;
  const tab = await tabOf(h, tabId);
  if (!tab) return `No tab ${tabId}.`;
  const base = builtSide ? r.built_base : r.source_base;
  const now = partOf(tab);
  const other = builtSide ? `design ${r.source_id}` : `prototype ${r.built_id}`;
  const when = r.synced_at ? new Date(Number(r.synced_at)).toISOString().slice(0, 16).replace("T", " ") : "?";
  if (JSON.stringify(base ?? null) === JSON.stringify(now ?? null)) return `Tab ${tabId} has not changed since it was last in step with ${other} (${when} UTC).`;
  if (DESIGN_KINDS.has(tab.kind)) {
    const a = (base ?? {}) as Record<string, string>, b = (now ?? {}) as Record<string, string>;
    const lines: string[] = [];
    for (const f of Object.keys(b)) if (!(f in a)) lines.push(`+ ${f} — a new artboard (read it with speca.designRead {file})`);
    for (const f of Object.keys(a)) if (!(f in b)) lines.push(`- ${f} — removed`);
    for (const f of Object.keys(b)) if (f in a && a[f] !== b[f]) {
      const ch = diffBoard(String(a[f] ?? ""), String(b[f] ?? ""));
      lines.push(`~ ${f}${ch.length ? `:\n${ch.slice(0, 40).map((x) => `    ${say(x)}`).join("\n")}${ch.length > 40 ? `\n    … ${ch.length - 40} more` : ""}` : " — markup changed (nothing visible)"}`);
    }
    return `Design canvas ${tabId} since it was last in step with ${other} (${when} UTC):\n${lines.join("\n")}`;
  }
  const diff = unified(typeof base === "string" ? base : JSON.stringify(base ?? "", null, 1), typeof now === "string" ? now : JSON.stringify(now ?? "", null, 1));
  const cut = diff.length > 60_000 ? `${diff.slice(0, 60_000)}\n… (cut; read the tab for the rest)` : diff;
  return `Tab ${tabId} (${tab.kind}) since it was last in step with ${other} (${when} UTC), as a diff:\n${cut}`;
}

/** Links of a chat, for the agent's view of its canvas. */
export async function linksText(h: H, agentId: string): Promise<string> {
  const rows = await sel<LinkRow>(h, `SELECT * FROM speca_links WHERE agent_id = ? AND built_id > 0`, [agentId]);
  const out: string[] = [];
  for (const r of rows) {
    const built = await tabOf(h, Number(r.built_id)), source = await tabOf(h, Number(r.source_id));
    if (!built || !source || built.closedAt || source.closedAt) continue;
    const st = stateOf(r, built, source);
    const s = [st.behind ? "the design changed since the last sync (not in the prototype)" : "", st.ahead ? "the prototype changed since the last sync (not in the design)" : ""].filter(Boolean).join("; ") || "in step";
    out.push(`- tab ${built.id} "${built.title}" is built from design ${source.id} "${source.title}" — ${s}`);
  }
  return out.join("\n");
}
