// Line diffs of canvas texts (an html page, a document, …): hunks with line numbers and context, like git diff.
// Used by the canvas "Compare" view and by the agent (canvas_read with diffFrom).

export type Op = { k: "same" | "del" | "ins"; a?: number; b?: number; text: string };
export type Hunk = { aStart: number; bStart: number; ops: Op[] };

/** The text a canvas is made of: its html or markdown, other kinds as indented JSON. */
export function canvasText(kind: string, state: Record<string, unknown>): string {
  // a page written on one line diffs as one line: break it between block tags so a change shows where it is
  if (typeof state.html === "string") return state.html.split("\n").length > 3 ? state.html : state.html.replace(/>\s*(?=<(?:\/?(?:h[1-6]|p|div|section|article|header|footer|main|nav|ul|ol|li|table|tr|thead|tbody|form|script|style|head|body|html|meta|link|title)\b|!--))/gi, ">\n");
  if (typeof state.markdown === "string") return state.markdown;
  return JSON.stringify(state, null, 2);
}

/** Line ops by LCS; very large inputs fall back to a trimmed common prefix/suffix with one replaced block. */
export function lineDiff(aText: string, bText: string): Op[] {
  const A = aText.split("\n"), B = bText.split("\n");
  let pre = 0;
  while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
  let suf = 0;
  while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
  const a = A.slice(pre, A.length - suf), b = B.slice(pre, B.length - suf);
  const ops: Op[] = [];
  for (let i = 0; i < pre; i++) ops.push({ k: "same", a: i + 1, b: i + 1, text: A[i]! });
  if (a.length * b.length > 4_000_000) {
    a.forEach((x, i) => ops.push({ k: "del", a: pre + i + 1, text: x }));
    b.forEach((x, i) => ops.push({ k: "ins", b: pre + i + 1, text: x }));
  } else {
    // LCS table from the end
    const n = a.length, m = b.length;
    const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i]![j] = a[i] === b[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[i] === b[j]) { ops.push({ k: "same", a: pre + i + 1, b: pre + j + 1, text: a[i]! }); i++; j++; }
      // removed lines before added ones, as git shows them
      else if (i < n && (j >= m || L[i + 1]![j]! >= L[i]![j + 1]!)) { ops.push({ k: "del", a: pre + i + 1, text: a[i]! }); i++; }
      else { ops.push({ k: "ins", b: pre + j + 1, text: b[j]! }); j++; }
    }
  }
  for (let k = 0; k < suf; k++) ops.push({ k: "same", a: A.length - suf + k + 1, b: B.length - suf + k + 1, text: A[A.length - suf + k]! });
  return ops;
}

/** Changed blocks with `context` unchanged lines around them. */
export function hunks(ops: Op[], context = 3): Hunk[] {
  const changed = ops.map((o, i) => (o.k === "same" ? -1 : i)).filter((i) => i >= 0);
  if (!changed.length) return [];
  const out: Hunk[] = [];
  let start = Math.max(0, changed[0]! - context), end = Math.min(ops.length - 1, changed[0]! + context);
  const flush = () => {
    const slice = ops.slice(start, end + 1);
    const first = slice.find((o) => o.a) ?? slice[0]!, firstB = slice.find((o) => o.b) ?? slice[0]!;
    out.push({ aStart: first.a ?? 0, bStart: firstB.b ?? 0, ops: slice });
  };
  for (const c of changed.slice(1)) {
    if (c - context <= end + 1) end = Math.min(ops.length - 1, c + context);
    else { flush(); start = Math.max(0, c - context); end = Math.min(ops.length - 1, c + context); }
  }
  flush();
  return out;
}

/** git-style text for the model: @@ -a +b @@ and +/- lines. */
export function unified(aText: string, bText: string, context = 3): string {
  const hs = hunks(lineDiff(aText, bText), context);
  if (!hs.length) return "(no differences)";
  return hs.map((h) => `@@ -${h.aStart} +${h.bStart} @@\n${h.ops.map((o) => `${o.k === "same" ? " " : o.k === "del" ? "-" : "+"}${o.text}`).join("\n")}`).join("\n");
}

export function stats(ops: Op[]): { added: number; removed: number } {
  return { added: ops.filter((o) => o.k === "ins").length, removed: ops.filter((o) => o.k === "del").length };
}
