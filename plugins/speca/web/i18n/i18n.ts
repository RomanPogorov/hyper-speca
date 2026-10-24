// i18n: every UI string goes through t(). Catalogs are TS objects so a missing Russian key is a type error.
// Plural forms: a value can be {one, few, many, other}; {n} and other {params} are substituted.
// Org terms (branding.terms) override catalog entries with the key `term.<name>`.
import { en } from "./en.ts";
import { ru } from "./ru.ts";

export type Locale = "en" | "ru";
export type Key = keyof typeof en;
type Entry = string | { one: string; few?: string; many?: string; other: string };

const CATALOGS: Record<Locale, Record<string, Entry>> = { en, ru };

export type Terms = Record<string, string | Record<string, string>>;

export type T = ((key: Key, params?: Record<string, string | number>) => string) & { locale: Locale };

/** The product's name for "{product}" in any string, from the configuration (branding.productName) — set by the app. */
let productName: () => string | undefined = () => undefined;
export function setProductName(fn: () => string | undefined) { productName = fn; }

export function makeT(locale: Locale, terms: Terms = {}): T {
  const cat = CATALOGS[locale] ?? CATALOGS.en;
  const pr = new Intl.PluralRules(locale);
  const fn = ((key: Key, params: Record<string, string | number> = {}) => {
    let entry: Entry | undefined;
    if (key.startsWith("term.")) {
      const term = terms[key.slice(5)];
      if (typeof term === "string") entry = term;
      else if (term && typeof term === "object") entry = term[locale] ?? term.en;
    }
    entry ??= cat[key] ?? CATALOGS.en[key] ?? key;
    let s: string;
    if (typeof entry === "string") s = entry;
    else {
      const n = Number(params.n ?? 0);
      const form = pr.select(n) as "one" | "few" | "many" | "other";
      s = entry[form] ?? entry.other;
    }
    return s.replace(/\{(\w+)\}/g, (_, k: string) => (params[k] !== undefined ? String(params[k]) : k === "product" && productName() ? productName()! : `{${k}}`));
  }) as T;
  fn.locale = locale;
  return fn;
}

export function pickLocale(opts: { user?: string | null; header?: string | null; org: Locale; allowed: Locale[] }): Locale {
  const ok = (l: string | null | undefined): l is Locale => !!l && (opts.allowed as string[]).includes(l);
  if (ok(opts.user)) return opts.user;
  for (const part of (opts.header ?? "").split(",")) {
    const l = part.trim().slice(0, 2).toLowerCase();
    if (ok(l)) return l;
  }
  return opts.org;
}
