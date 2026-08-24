// Small display helpers. Beatmap columns come back from Postgres as strings
// or nulls depending on how they were submitted, so everything is defensive.

export function value(v, fallback = "—") {
  if (v === null || v === undefined || v === "") return fallback;
  return String(v);
}

export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

// "2026-09" -> "September 2026". Anything else is passed through.
export function monthLabel(month) {
  if (!month) return null;
  const match = /^(\d{4})-(\d{2})$/.exec(String(month).trim());
  if (!match) return String(month);
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function dateTimeLabel(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Each step is [unit, how many of them make the next unit up].
const RELATIVE_STEPS = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 7],
  ["week", 4.35],
];

// "just now" / "5 minutes ago" / "3 days ago" for comment timestamps. Intl
// does the wording so it follows the reader's locale, and anything older than
// about a month gets the real date instead — "6 weeks ago" is harder to place
// than "Tue, 3 Jun".
export function timeAgo(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";

  // A comment posted seconds ago can land a hair in the future if the server
  // clock is slightly ahead; treat that as "just now" rather than "in 0
  // seconds".
  const seconds = (Date.now() - then) / 1000;
  if (seconds < 45) return "just now";
  if (seconds > 30 * 86400) return dateTimeLabel(iso);
  if (typeof Intl === "undefined" || !Intl.RelativeTimeFormat) return dateTimeLabel(iso);

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  let value = seconds;
  for (const [unit, perNext] of RELATIVE_STEPS) {
    if (value < perNext) return rtf.format(-Math.round(value), unit);
    value /= perNext;
  }
  return rtf.format(-Math.round(value), "month");
}

// Milliseconds -> "4d 06h 12m 09s", trimmed to the largest useful units.
export function countdownLabel(ms) {
  if (ms <= 0) return "closed";
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  if (days > 0) return `${days}d ${pad(hours)}h ${pad(minutes)}m`;
  return `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
}

export function sharePercent(votes, totalVoters) {
  if (!totalVoters) return 0;
  return Math.round((votes / totalVoters) * 100);
}

// Value for <input type="datetime-local"> from an ISO timestamp.
export function toLocalInputValue(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
