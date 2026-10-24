// Formatting of times and durations for the UI (in the person's time zone and language).
export function clock(d: Date | string | number, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(d));
}

export function dateLong(d: Date, tz: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(d);
}

export function dur(ms: number, locale: string): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  if (locale === "ru") return h ? `${h} ч ${m} мин` : m ? `${m} мин ${String(x).padStart(2, "0")} с` : `${x} с`;
  return h ? `${h} h ${m} min` : m ? `${m} min ${String(x).padStart(2, "0")} s` : `${x} s`;
}

/** A wait to the minute (rounded up), no seconds: "4 ч 16 мин", "25 мин" — when something comes or resets. */
export function durMin(ms: number, locale: string): string {
  const all = Math.max(1, Math.ceil(ms / 60_000)), h = Math.floor(all / 60), m = all % 60;
  if (locale === "ru") return h ? `${h} ч${m ? ` ${m} мин` : ""}` : `${m} мин`;
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
}

export function rel(d: Date | string, locale: string, now = new Date()): string {
  const min = Math.floor((now.getTime() - new Date(d).getTime()) / 60000);
  if (locale === "ru") {
    if (min < 1) return "сейчас";
    if (min < 60) return `${min} мин`;
    const h = Math.floor(min / 60);
    return h < 24 ? `${h} ч` : `${Math.floor(h / 24)} д`;
  }
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

export function hourIn(tz: string, now = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: tz }).format(now));
}
