// Shared word counter. The browser uses an identical copy in public/app.js,
// so the live meter and the server always agree.
const WORD = /[\p{L}\p{N}][\p{L}\p{N}\p{M}'’\-]*/gu;

export function countWords(text: string): number {
  if (!text) return 0;
  const m = text.match(WORD);
  return m ? m.length : 0;
}

export const DAILY_GOAL = 500;

export function dayIn(tz: string, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  }
}

export function validTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// "2026-11-24" -> "2026-11-23"
export function prevDay(day: string): string {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function streaks(byDay: Map<string, number>, today: string, goal = DAILY_GOAL) {
  // Current streak: today counts if met; if today isn't met yet the streak
  // from yesterday is still alive.
  let current = 0;
  let d = (byDay.get(today) ?? 0) >= goal ? today : prevDay(today);
  while ((byDay.get(d) ?? 0) >= goal) {
    current++;
    d = prevDay(d);
  }
  // Longest streak over all history.
  const metDays = [...byDay.entries()].filter(([, w]) => w >= goal).map(([k]) => k).sort();
  let longest = 0, run = 0, last = "";
  for (const day of metDays) {
    run = last && prevDay(day) === last ? run + 1 : 1;
    if (run > longest) longest = run;
    last = day;
  }
  return { current, longest, daysMet: metDays.length };
}
