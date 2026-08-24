// =====================================================================
// Input validation / normalisation for the public API.
//
// Every one of these is a pure function, so they're unit tested in
// test/validate.test.js (`npm test`) without a database or a server.
//
// The rules are deliberately boring: trim, cap the length, and refuse
// anything that isn't the shape the database column expects. The point is
// that a hand-crafted request can't put 4 MB of text in a "★" field or
// invent user rows with ids the app never issued.
// =====================================================================

// Column caps. Postgres TEXT has no limit of its own, so this is where the
// limit lives. Generous enough for real submissions, small enough that a
// list response stays a sane size.
const LIMITS = {
  title: 300,
  url: 500,
  stat: 32, // stars / cs / ar / od / hp / bpm / length — short strings like "6.42" or "N/A"
  // Song credits, from the osu! lookup rather than typed. Generous because
  // real beatmap sets carry long romanised-plus-original artist names, and a
  // truncated artist would break the card's "strip the prefix off title" step.
  artist: 200,
  mapper: 100,
  difficultyName: 100,
  slot: 40,
  mod: 40,
  skill: 80,
  notes: 1000,
  type: 20,
  comment: 500,
  commentBody: 1000, // threaded discussion on /vote — roomier than a one-liner
  displayName: 20,
  imageUrl: 500,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Trim, collapse "" to null, and cut anything past `max`. Numbers and other
// scalars are stringified, because the submit forms post whatever the input
// held; objects/arrays are rejected outright (null) so they can't smuggle
// structure into a TEXT column.
function text(value, max) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

// http(s) only. Blocks javascript:, data: and friends before they can reach
// an href in the browser or an embed field in Discord.
function isHttpUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

// Returns the URL when it's a usable http(s) link, else null. Handy for
// optional fields where "no link" and "bad link" should behave the same.
function httpUrl(value, max = LIMITS.imageUrl) {
  const candidate = text(value, max);
  return candidate && isHttpUrl(candidate) ? candidate : null;
}

// A positive integer, from a string or a number. Rejects NaN, 0, negatives,
// floats and "12abc" — Number() alone would happily accept some of those.
function positiveInt(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

// The osu! beatmap id out of `/api/beatmap/:id`. Without this, a path like
// `..%2F..%2Fusers%2F2` would be pasted straight into the osu! API URL and
// normalised by the HTTP layer into a completely different endpoint —
// turning the proxy into a general-purpose osu! API client using our token.
function osuBeatmapId(value) {
  const n = positiveInt(value);
  return n !== null && n <= Number.MAX_SAFE_INTEGER ? n : null;
}

// Normalises a beatmap submission body. Returns { error } or { fields }.
// `submitted_by` must look like an id we issued (uuid) — see server.js for
// why that matters when self-healing a missing users row.
function beatmapSubmission(body = {}) {
  const title = text(body.title, LIMITS.title);
  const url = text(body.url, LIMITS.url);

  if (!title) return { error: "A title is required" };
  if (!url) return { error: "A beatmap URL is required" };
  if (!isHttpUrl(url)) return { error: "The beatmap URL must be an http(s) link" };

  return {
    fields: {
      title,
      url,
      // The pieces behind `title`, for the ballot card that shows them on
      // separate lines. All optional: they only arrive from the osu! lookup,
      // and a submission typed by hand legitimately has none of them.
      artist: text(body.artist, LIMITS.artist),
      mapper: text(body.mapper, LIMITS.mapper),
      difficulty_name: text(body.difficulty_name, LIMITS.difficultyName),
      stars: text(body.stars, LIMITS.stat),
      cs: text(body.cs, LIMITS.stat),
      ar: text(body.ar, LIMITS.stat),
      od: text(body.od, LIMITS.stat),
      hp: text(body.hp, LIMITS.stat),
      bpm: text(body.bpm, LIMITS.stat),
      length: text(body.length, LIMITS.stat),
      slot: text(body.slot, LIMITS.slot),
      mod: text(body.mod, LIMITS.mod),
      skill: text(body.skill, LIMITS.skill),
      notes: text(body.notes, LIMITS.notes),
      cover_url: httpUrl(body.cover_url),
      preview_url: httpUrl(body.preview_url),
      type: text(body.type, LIMITS.type) === "suggestion" ? "suggestion" : "bounty",
    },
  };
}

// A comment on a challenge map. Unlike text(), newlines survive — people
// write paragraphs — so this normalises the whitespace they bring with them:
// CRLF from a Windows textarea, trailing spaces, and the run of blank lines
// someone uses to shove their comment up the page. Everything else is left
// alone; the body is rendered as text, never as HTML, so `<b>` is just `<b>`.
function commentBody(value, max = LIMITS.commentBody) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return null;

  const normalised = String(value)
    .replace(/\r\n?/g, "\n") //     CRLF / lone CR -> LF
    .replace(/[^\S\n]+$/gm, "") //  trailing spaces and tabs, per line
    .replace(/\n{3,}/g, "\n\n"); // at most one blank line in a row

  // Capping after normalising means the limit counts characters someone can
  // actually see, and the second trim tidies a cut that landed on a space.
  const capped = normalised.slice(0, max).trim();
  return capped || null;
}

// An ISO 3166-1 alpha-2 country code, the shape osu! reports ("DZ"). Exactly
// two letters or nothing: this value decides who is allowed to vote, so a half
// understood input has to become null rather than a guess that might happen to
// match an allowed country. Note that null is therefore "not eligible", not
// "eligible by default" — the caller relies on that.
function countryCode(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return null;
  const code = String(value).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

// "dz, fr" -> ["DZ", "FR"], for the VOTER_COUNTRIES allowlist. Anything that
// isn't a country code is dropped, so a stray comma or a trailing space in the
// environment can't widen the allowlist to include "".
function countryList(value) {
  const codes = new Set();
  for (const part of String(value ?? "").split(",")) {
    const code = countryCode(part);
    if (code) codes.add(code);
  }
  return [...codes];
}

module.exports = {
  LIMITS,
  text,
  isUuid,
  isHttpUrl,
  httpUrl,
  positiveInt,
  osuBeatmapId,
  beatmapSubmission,
  commentBody,
  countryCode,
  countryList,
};
