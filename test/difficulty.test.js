// Unit tests for vote-client/src/difficulty.js — the star-rating spectrum and
// the title splitter behind the ballot cards. Run with `npm test` (no
// database, no server, no browser).
//
// Two things here are worth knowing up front.
//
// First, the module is ESM (it's part of the Vite client, where
// vote-client/package.json sets "type": "module") while this file is CommonJS
// like the rest of test/. Dynamic import() bridges that, loaded once and
// memoised rather than per test.
//
// Second, most of these assertions are about *edges*: the exact rating where
// one colour or difficulty name takes over from the next, and the titles that
// look splittable but aren't. Those are the cases where being confidently
// wrong is worse than doing nothing, because the card would then show a song
// name that isn't the song's name.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// A file URL, not a relative specifier: this is a CJS file reaching into the
// client's ESM tree, and a URL resolves the same way on every platform.
const MODULE_URL = pathToFileURL(
  path.join(__dirname, "..", "vote-client", "src", "difficulty.js")
).href;

let loading;
const load = () => {
  loading ??= import(MODULE_URL);
  return loading;
};

const HEX = /^#[0-9a-f]{6}$/;
const DARK_INK = "#140d20";
const WHITE = "#ffffff";
const UNRATED = "#9aa0b8";

test("starValue() reads a rating out of whatever the column holds", async () => {
  const { starValue } = await load();

  assert.equal(starValue("6.42"), 6.42);
  assert.equal(starValue(6.42), 6.42);
  assert.equal(starValue("0"), 0);
  // Older rows were typed by hand and some carry the glyph with them.
  assert.equal(starValue("★6.42"), 6.42);
  assert.equal(starValue(" 6.42 "), 6.42);
});

test("starValue() returns null for anything that isn't a rating", async () => {
  const { starValue } = await load();

  // "N/A" is a real value in this column — the osu! lookup writes it — so it
  // has to become null rather than NaN leaking into a style attribute.
  for (const junk of ["N/A", "", "   ", "★", "abc", "12abc", "-1", "Infinity", null, undefined, {}, []]) {
    assert.equal(starValue(junk), null, `${JSON.stringify(junk)} is not a rating`);
  }
});

test("starColour() puts every spectrum stop on its own colour", async () => {
  const { starColour } = await load();

  // The stops as osu! draws them, except the top two — see the module comment
  // for why the hardest maps go pale here instead of near-black.
  assert.equal(starColour("0"), "#4290fb");
  assert.equal(starColour("1.25"), "#4fc0ff");
  assert.equal(starColour("2"), "#4fffd5");
  assert.equal(starColour("2.5"), "#7cff4f");
  assert.equal(starColour("3.3"), "#f6f05c");
  assert.equal(starColour("4.2"), "#ff8068");
  assert.equal(starColour("4.9"), "#ff4e6f");
  assert.equal(starColour("5.8"), "#e35fd0");
  assert.equal(starColour("6.7"), "#8f6bff");
  assert.equal(starColour("7.7"), "#c9b6ff");
  assert.equal(starColour("9"), WHITE);
});

test("starColour() clamps outside the spectrum instead of running off it", async () => {
  const { starColour } = await load();

  // Nothing ranked is past 9★, but a loved or an unranked map can be, and a
  // bad row can say anything at all. Both ends stay on the palette.
  assert.equal(starColour("12"), WHITE);
  assert.equal(starColour("999"), WHITE);
  assert.equal(starColour("0"), "#4290fb");

  // Unrated is off the spectrum on purpose: grey says "we don't know", where
  // blue would claim the map is easy.
  assert.equal(starColour("N/A"), UNRATED);
  assert.equal(starColour(null), UNRATED);
  assert.equal(starColour(""), UNRATED);
});

test("starColour() blends between stops rather than snapping to one", async () => {
  const { starColour } = await load();

  // 1.625 is the midpoint of the 1.25 -> 2.0 leg. The exact hex isn't the
  // contract; being a genuine blend of the two ends is, because that's what
  // makes two maps a tenth of a star apart look different on the shelf.
  const low = [0x4f, 0xc0, 0xff]; // #4fc0ff at 1.25
  const high = [0x4f, 0xff, 0xd5]; // #4fffd5 at 2.0
  const blended = starColour("1.625");

  assert.match(blended, HEX);
  assert.notEqual(blended, "#4fc0ff");
  assert.notEqual(blended, "#4fffd5");

  const channels = [1, 3, 5].map((at) => parseInt(blended.slice(at, at + 2), 16));
  channels.forEach((value, i) => {
    const min = Math.min(low[i], high[i]);
    const max = Math.max(low[i], high[i]);
    assert.ok(value >= min && value <= max, `channel ${i} (${value}) left the ${min}..${max} leg`);
  });
});

test("starColour() always returns a six-digit lowercase hex", async () => {
  const { starColour } = await load();

  // The result goes straight into a CSS custom property. A five-digit hex from
  // a channel that lost its leading zero wouldn't throw anywhere — the card
  // would just quietly lose its accent.
  const ratings = ["N/A", null, undefined, "", 0, 0.01, 1.24, 1.26, 2.49, 3.29, 4.19, 4.89, 5.79, 6.69, 7.69, 8.99, 9.01, 50];
  for (const rating of ratings) {
    assert.match(starColour(rating), HEX, `${JSON.stringify(rating)} produced a bad colour`);
  }
  // And every tenth of a star through the usable range.
  for (let stars = 0; stars <= 10; stars += 0.1) {
    assert.match(starColour(stars.toFixed(2)), HEX, `${stars} produced a bad colour`);
  }
});

test("readableInk() picks the ink that can actually be read", async () => {
  const { readableInk } = await load();

  assert.equal(readableInk("#ffffff"), DARK_INK);
  assert.equal(readableInk("#f6f05c"), DARK_INK); // the yellow leg
  assert.equal(readableInk("#000000"), WHITE);
  assert.equal(readableInk("#4a3f8a"), WHITE); // a dark violet, like the card itself
});

test("readableInk() flips exactly once, in the right direction", async () => {
  const { readableInk } = await load();

  // The property that matters: as a background gets lighter the ink goes white
  // -> dark and never back. A greyscale sweep is the cleanest way to see it,
  // and it catches a luminance formula with its channels or its gamma the
  // wrong way round without this test reimplementing the formula.
  const inks = [];
  for (let grey = 0; grey <= 255; grey += 5) {
    const hex = `#${grey.toString(16).padStart(2, "0").repeat(3)}`;
    inks.push({ grey, ink: readableInk(hex) });
  }

  const flip = inks.findIndex((step) => step.ink === DARK_INK);
  assert.ok(flip > 0, "dark ink never took over, so light backgrounds are unreadable");
  assert.ok(inks.slice(0, flip).every((step) => step.ink === WHITE), "a dark grey was given dark ink");
  assert.ok(inks.slice(flip).every((step) => step.ink === DARK_INK), "ink went back to white on a lighter grey");

  // Sanity: the crossover sits in the middle of the range, not at either end.
  const boundary = inks[flip].grey;
  assert.ok(boundary > 90 && boundary < 160, `crossover at #${boundary.toString(16)} looks wrong`);
});

test("every spectrum colour is light enough for dark ink", async () => {
  const { starColour, readableInk } = await load();

  // Worth pinning down, because it's what the card's tier badge relies on: the
  // badge is filled with the accent and its text is dark, and that holds for
  // the whole spectrum including the unrated grey. If a future stop goes dark
  // enough to need white text, this fails and the badge gets looked at again
  // rather than silently shipping unreadable text.
  for (let stars = 0; stars <= 10; stars += 0.05) {
    const colour = starColour(stars.toFixed(2));
    assert.equal(readableInk(colour), DARK_INK, `${stars.toFixed(2)}★ (${colour}) needs white ink`);
  }
  assert.equal(readableInk(UNRATED), DARK_INK);
});

test("tierName() uses osu!'s own difficulty names, at osu!'s own boundaries", async () => {
  const { tierName } = await load();

  assert.equal(tierName("0"), "Easy");
  assert.equal(tierName("1.99"), "Easy");
  assert.equal(tierName("2"), "Normal");
  assert.equal(tierName("2.69"), "Normal");
  assert.equal(tierName("2.7"), "Hard");
  assert.equal(tierName("3.99"), "Hard");
  assert.equal(tierName("4"), "Insane");
  assert.equal(tierName("5.29"), "Insane");
  assert.equal(tierName("5.3"), "Expert");
  assert.equal(tierName("6.49"), "Expert");
  assert.equal(tierName("6.5"), "Expert+");
  assert.equal(tierName("9.9"), "Expert+");

  // No rating, no name. The card leaves the badge off rather than printing a
  // guess or the word "null".
  assert.equal(tierName("N/A"), null);
  assert.equal(tierName(null), null);
});

test("starGlyphs() draws one star per whole star, within reason", async () => {
  const { starGlyphs } = await load();

  assert.equal(starGlyphs("3.4"), 3);
  assert.equal(starGlyphs("3.6"), 4);
  assert.equal(starGlyphs("6"), 6);
  // A rated map always gets at least one glyph, even a 0.4★ tutorial: rounding
  // to zero would make it look unrated.
  assert.equal(starGlyphs("0.4"), 1);
  assert.equal(starGlyphs("0"), 1);
  // Unrated gets none — that's the difference the row above protects.
  assert.equal(starGlyphs("N/A"), 0);
  // Capped, so one bad row can't stretch the card off the page.
  assert.equal(starGlyphs("99"), 12);
  assert.equal(starGlyphs("1e6"), 12);
});

test("starLabel() prints two decimals, or a question mark", async () => {
  const { starLabel } = await load();

  assert.equal(starLabel("6.4"), "6.40");
  assert.equal(starLabel("★6.428"), "6.43");
  assert.equal(starLabel(7), "7.00");
  assert.equal(starLabel("N/A"), "?");
  assert.equal(starLabel(null), "?");
});

test("songName() lifts the song out of a title built by the lookup", async () => {
  const { songName } = await load();

  assert.equal(
    songName({ title: "Camellia - GHOST [Emperor]", artist: "Camellia", difficulty_name: "Emperor" }),
    "GHOST"
  );
  // osu! titles are inconsistently cased between the set and the difficulty
  // listing, so the match ignores case.
  assert.equal(
    songName({ title: "Camellia - GHOST [emperor]", artist: "CAMELLIA", difficulty_name: "Emperor" }),
    "GHOST"
  );
  // Only the difficulty at the very end comes off. A "[TV Size]" that's part
  // of the song's actual name stays.
  assert.equal(
    songName({ title: "nano - Now or Never [TV Size] [Insane]", artist: "nano", difficulty_name: "Insane" }),
    "Now or Never [TV Size]"
  );
  // A difficulty name full of characters that mean something to a regex. This
  // is a string comparison, not a pattern, so they don't.
  assert.equal(
    songName({ title: "Some Artist - Song [4K Insane (+)]", artist: "Some Artist", difficulty_name: "4K Insane (+)" }),
    "Song"
  );
});

test("songName() leaves a title alone when the parts don't match it", async () => {
  const { songName } = await load();

  // The case that matters most: every row submitted before artist / mapper /
  // difficulty_name existed has them NULL, and its title is still the full
  // "Artist - Song [Diff]" string. Guessing where to cut it is exactly what
  // this function refuses to do.
  assert.equal(songName({ title: "Camellia - GHOST [Emperor]" }), "Camellia - GHOST [Emperor]");

  // Hand-edited titles, where a stored song name would have drifted.
  assert.equal(
    songName({ title: "my favourite map ever", artist: "Camellia", difficulty_name: "Emperor" }),
    "my favourite map ever"
  );
  // The artist appears in the title but not as the prefix.
  assert.equal(
    songName({ title: "Remix of Camellia - GHOST [Emperor]", artist: "Camellia", difficulty_name: "Emperor" }),
    "Remix of Camellia - GHOST"
  );
  // Close, but not the separator the lookup writes.
  assert.equal(songName({ title: "Camellia-GHOST", artist: "Camellia" }), "Camellia-GHOST");
  assert.equal(songName({ title: "Camellia — GHOST", artist: "Camellia" }), "Camellia — GHOST");
  // A difficulty that isn't in brackets, and one that's in the middle.
  assert.equal(songName({ title: "Camellia - GHOST Emperor", artist: "Camellia", difficulty_name: "Emperor" }), "GHOST Emperor");
});

test("songName() always returns something printable", async () => {
  const { songName } = await load();

  assert.equal(songName({ title: "" }), "Untitled");
  assert.equal(songName({ title: "   " }), "Untitled");
  assert.equal(songName({}), "Untitled");
  assert.equal(songName(), "Untitled");
  assert.equal(songName(null), "Untitled");
  // Stripping both ends off this one leaves an empty string, so it keeps the
  // whole title instead of rendering a blank line where the song should be.
  assert.equal(
    songName({ title: "Camellia - [Emperor]", artist: "Camellia", difficulty_name: "Emperor" }),
    "Camellia - [Emperor]"
  );
  // Non-string columns can't happen through the API, but the card also renders
  // optimistically from local state after a submit.
  assert.equal(songName({ title: 123 }), "123");
  assert.equal(songName({ title: "GHOST", artist: {}, difficulty_name: [] }), "GHOST");
});
