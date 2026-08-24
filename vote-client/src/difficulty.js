// =====================================================================
// Star rating -> the colour of a ballot card, in osu!'s own vocabulary.
//
// The cards on /vote carry a neon edge, and that edge is the star rating
// rather than decoration: a player scanning the hand reads the spread of
// difficulty before reading a single word. Which means the mapping has to be
// the one they already know from the game's own beatmap listings, not a
// palette invented here.
//
// Pure and dependency-free so it can be unit tested (test/difficulty.test.js)
// without a browser — same reason lib/eligibility.js is its own file.
// =====================================================================

// osu!'s star spectrum: [rating, colour] stops, interpolated between. Taken
// from the game, with one deliberate departure at the top — osu! runs 7.7★ to
// #18158E and 9★+ to black, which works against its light beatmap panels and
// disappears completely against a dark card. Above 6.7 this keeps going up in
// luminance instead of down, so the hardest maps read as the hottest thing on
// the page rather than as a hole in it.
const SPECTRUM = [
  [0.0, "#4290fb"], // blue
  [1.25, "#4fc0ff"], // light blue
  [2.0, "#4fffd5"], // cyan
  [2.5, "#7cff4f"], // green
  [3.3, "#f6f05c"], // yellow
  [4.2, "#ff8068"], // salmon
  [4.9, "#ff4e6f"], // red
  [5.8, "#e35fd0"], // magenta — lighter than osu!'s #c645b8, see below
  [6.7, "#8f6bff"], // violet
  [7.7, "#c9b6ff"], // pale violet — osu! goes dark here, see above
  [9.0, "#ffffff"], // white hot
];

// Why the magenta moved: #c645b8 lands at a relative luminance of 0.197, which
// is within a rounding error of the point where dark text and white text on it
// are equally bad — about 4.3:1 either way, i.e. legible for nothing smaller
// than a heading. It was the one stop that couldn't carry a filled badge. The
// lighter magenta clears 5:1 against the card's ink and has the side benefit of
// sitting closer to the site's own --vote-pink, so 5-6★ maps stop clashing with
// the page they're on. Every other stop was already comfortable.

// Not on the spectrum at all: "we don't know". A map submitted before the
// lookup existed, or one the osu! API answered without a rating, gets a
// neutral slate rather than being drawn as an easy map.
const UNRATED = "#9aa0b8";

// The card's dark ink, for accents light enough that white text on them would
// be unreadable. Not pure black: it sits on a violet card.
const DARK_INK = "#140d20";
const DARK_INK_LUMINANCE = 0.0075;

// osu!'s difficulty names, by the same rating. These are the words players
// use, so the card says "Insane" and not "tier 4".
const TIERS = [
  [2.0, "Easy"],
  [2.7, "Normal"],
  [4.0, "Hard"],
  [5.3, "Insane"],
  [6.5, "Expert"],
];
const TOP_TIER = "Expert+";

// Stat columns are TEXT — they hold whatever the lookup returned, including
// the literal "N/A" — and older rows sometimes carry a leading star glyph from
// when the form pasted one in. null means "no usable number", which every
// caller here treats as unrated rather than as zero.
export function starValue(raw) {
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw).replace(/[★⭐\s]/g, "");
  if (!cleaned) return null;
  const stars = Number(cleaned);
  return Number.isFinite(stars) && stars >= 0 ? stars : null;
}

function channels(hex) {
  const clean = String(hex).replace("#", "");
  return [0, 2, 4].map((at) => parseInt(clean.slice(at, at + 2), 16));
}

function mix(from, to, ratio) {
  const a = channels(from);
  const b = channels(to);
  const hex = a
    .map((value, i) => Math.round(value + (b[i] - value) * ratio))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `#${hex}`;
}

// The accent colour for a rating. Interpolated rather than snapped to the
// nearest tier, so two maps a tenth of a star apart don't look identical —
// which is the whole point of colouring the edge in the first place.
export function starColour(raw) {
  const stars = starValue(raw);
  if (stars === null) return UNRATED;

  const [firstAt, firstColour] = SPECTRUM[0];
  if (stars <= firstAt) return firstColour;

  for (let i = 1; i < SPECTRUM.length; i += 1) {
    const [at, colour] = SPECTRUM[i];
    const [previousAt, previousColour] = SPECTRUM[i - 1];
    if (stars < at) return mix(previousColour, colour, (stars - previousAt) / (at - previousAt));
  }

  return SPECTRUM[SPECTRUM.length - 1][1];
}

// Relative luminance, WCAG's formula. Only used to choose an ink colour.
function luminance(hex) {
  const [r, g, b] = channels(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Text that stays readable on top of `hex`. Picks whichever of white and the
// card's dark ink actually contrasts better, rather than guessing from a
// brightness threshold — the spectrum runs through both #4fffd5 and #4290fb,
// and a fixed cutoff gets one of those two wrong.
export function readableInk(hex) {
  const light = luminance(hex);
  const againstWhite = 1.05 / (light + 0.05);
  const againstInk = (light + 0.05) / (DARK_INK_LUMINANCE + 0.05);
  return againstInk >= againstWhite ? DARK_INK : "#ffffff";
}

export function tierName(raw) {
  const stars = starValue(raw);
  if (stars === null) return null;
  for (const [below, name] of TIERS) {
    if (stars < below) return name;
  }
  return TOP_TIER;
}

// How many star glyphs to draw next to the number. One per whole star, which
// is what makes a 6★ card visibly longer than a 3★ one at a glance. Capped at
// 12: nothing ranked goes past that, and an unbounded loop here would let a
// bad row stretch the card.
export function starGlyphs(raw) {
  const stars = starValue(raw);
  if (stars === null) return 0;
  return Math.max(1, Math.min(12, Math.round(stars)));
}

// The rating as the card prints it: two decimals, because that's how osu!
// shows it and because "4.5" and "4.46" side by side look like a data error.
export function starLabel(raw) {
  const stars = starValue(raw);
  return stars === null ? "?" : stars.toFixed(2);
}

// `title` is one string — "Artist - Song [Difficulty]" — built by the osu!
// proxy, and the card wants the song on its own line. The parts are stored
// separately now, so this strips them off the ends *only when they match
// exactly*. Anything else is left whole: someone who retyped the title by hand
// should see what they typed, not a confident wrong guess at where the song
// name ends.
export function songName(map) {
  const title = String(map?.title ?? "").trim();
  if (!title) return "Untitled";

  let name = title;

  const artist = String(map?.artist ?? "").trim();
  const prefix = `${artist} - `;
  if (artist && name.toLowerCase().startsWith(prefix.toLowerCase())) {
    name = name.slice(prefix.length).trim();
  }

  const difficulty = String(map?.difficulty_name ?? "").trim();
  const suffix = `[${difficulty}]`;
  if (difficulty && name.toLowerCase().endsWith(suffix.toLowerCase())) {
    name = name.slice(0, name.length - suffix.length).trim();
  }

  // Stripping both ends off "Artist - [Diff]" leaves nothing; the whole title
  // is a worse answer than nothing at all here, but it's an honest one.
  return name || title;
}
