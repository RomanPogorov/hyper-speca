// Server-side HTML: a tagged template with auto-escaping. raw() only for already-safe HTML.
const RAW = Symbol("raw");
export type Raw = { [RAW]: true; html: string; toString(): string };

export function raw(html: string): Raw {
  return { [RAW]: true, html, toString: () => html };
}
export function isRaw(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && (v as Record<symbol, unknown>)[RAW] === true;
}

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

type Part = string | number | boolean | null | undefined | Raw | Part[];

function render(v: Part): string {
  if (v === null || v === undefined || v === false) return "";
  // attributes like aria-current="${cond}" need the literal "true"
  if (v === true) return "true";
  if (Array.isArray(v)) return v.map(render).join("");
  if (isRaw(v)) return v.html;
  return esc(v);
}

export function html(strings: TemplateStringsArray, ...values: Part[]): Raw {
  let out = strings[0]!;
  for (let i = 0; i < values.length; i++) out += render(values[i]!) + strings[i + 1]!;
  return raw(out);
}

/** Joins fragments (already Raw) — convenience for lists. */
export function join(items: Raw[], sep = ""): Raw {
  return raw(items.map((x) => x.html).join(sep));
}

/** Attribute helper: attrs({ "data-id": id, hidden: true }) */
export function attrs(o: Record<string, string | number | boolean | null | undefined>): Raw {
  return raw(
    Object.entries(o)
      .filter(([, v]) => v !== null && v !== undefined && v !== false)
      .map(([k, v]) => (v === true ? k : `${k}="${esc(v)}"`))
      .join(" "),
  );
}
