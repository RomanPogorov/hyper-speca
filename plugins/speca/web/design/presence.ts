// Who else is on a design canvas, kept in memory (Speca's core keeps it the same way): each person's cursor (world px)
// and selection, as their browser last posted it. Gone after 30 seconds without a word.
type Peer = { userId: string; name: string; state: Record<string, unknown>; at: number };
const byTab = new Map<number, Map<string, Peer>>();
const TTL = 30_000;

export function announce(tabId: number, who: { userId: string; name: string }, state: unknown) {
  const m = byTab.get(tabId) ?? new Map<string, Peer>();
  byTab.set(tabId, m);
  if (!state || typeof state !== "object") { m.delete(who.userId); return; }
  m.set(who.userId, { ...who, state: { ...(state as object) }, at: Date.now() });
}

export function peers(tabId: number, me: string): Array<Omit<Peer, "at">> {
  const m = byTab.get(tabId);
  if (!m) return [];
  const now = Date.now();
  for (const [k, p] of m) if (now - p.at > TTL) m.delete(k);
  return [...m.values()].filter((p) => p.userId !== me).map(({ at: _at, ...p }) => p);
}
