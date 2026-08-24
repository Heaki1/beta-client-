// Unit tests for lib/validate.js — the layer that decides what a request is
// allowed to put in the database. Run with `npm test` (no database, no server).
const test = require("node:test");
const assert = require("node:assert/strict");

const valid = require("../lib/validate");

test("text() trims, nulls out blanks and caps the length", () => {
  assert.equal(valid.text("  Freedom Dive  ", 300), "Freedom Dive");
  assert.equal(valid.text("", 300), null);
  assert.equal(valid.text("   ", 300), null);
  assert.equal(valid.text(null, 300), null);
  assert.equal(valid.text(undefined, 300), null);
  assert.equal(valid.text("x".repeat(400), 300).length, 300);
  // Numbers come out of the stats inputs as numbers often enough.
  assert.equal(valid.text(6.42, 32), "6.42");
});

test("text() refuses objects and arrays", () => {
  // A JSON body can hold structure; a TEXT column shouldn't have to cope with
  // "[object Object]" or a comma-joined array.
  assert.equal(valid.text({ toString: () => "evil" }, 300), null);
  assert.equal(valid.text(["a", "b"], 300), null);
});

test("isUuid() accepts ids we issue and rejects everything else", () => {
  assert.equal(valid.isUuid("f47ac10b-58cc-4372-a567-0e02b2c3d479"), true);
  assert.equal(valid.isUuid("F47AC10B-58CC-4372-A567-0E02B2C3D479"), true);
  assert.equal(valid.isUuid("  f47ac10b-58cc-4372-a567-0e02b2c3d479  "), true);
  assert.equal(valid.isUuid("not-a-uuid"), false);
  assert.equal(valid.isUuid("f47ac10b58cc4372a5670e02b2c3d479"), false);
  assert.equal(valid.isUuid(""), false);
  assert.equal(valid.isUuid(null), false);
  assert.equal(valid.isUuid(12345), false);
});

test("isHttpUrl() allows http(s) and blocks script-bearing schemes", () => {
  assert.equal(valid.isHttpUrl("https://osu.ppy.sh/beatmapsets/1#osu/2"), true);
  assert.equal(valid.isHttpUrl("http://localhost:3000/x"), true);
  assert.equal(valid.isHttpUrl("javascript:alert(1)"), false);
  assert.equal(valid.isHttpUrl("data:text/html,<script>alert(1)</script>"), false);
  assert.equal(valid.isHttpUrl("file:///etc/passwd"), false);
  // Relative paths aren't links we can hand to a browser or to Discord.
  assert.equal(valid.isHttpUrl("/"), false);
  assert.equal(valid.isHttpUrl("osu.ppy.sh"), false);
  assert.equal(valid.isHttpUrl(""), false);
  assert.equal(valid.isHttpUrl(null), false);
});

test("httpUrl() returns the link or null, never a bad link", () => {
  assert.equal(valid.httpUrl(" https://b.ppy.sh/preview/1.mp3 "), "https://b.ppy.sh/preview/1.mp3");
  assert.equal(valid.httpUrl("javascript:alert(1)"), null);
  // The placeholder older submissions stored in preview_url.
  assert.equal(valid.httpUrl("/"), null);
  assert.equal(valid.httpUrl(undefined), null);
});

test("positiveInt() rejects anything that isn't a whole positive number", () => {
  assert.equal(valid.positiveInt(42), 42);
  assert.equal(valid.positiveInt("42"), 42);
  assert.equal(valid.positiveInt(" 42 "), 42);
  assert.equal(valid.positiveInt(0), null);
  assert.equal(valid.positiveInt(-1), null);
  assert.equal(valid.positiveInt(1.5), null);
  assert.equal(valid.positiveInt("12abc"), null);
  assert.equal(valid.positiveInt("NaN"), null);
  assert.equal(valid.positiveInt(""), null);
  assert.equal(valid.positiveInt(null), null);
});

test("osuBeatmapId() blocks path traversal into the osu! API", () => {
  assert.equal(valid.osuBeatmapId("1234567"), 1234567);
  // These are the shapes that would otherwise be interpolated into the
  // upstream URL and resolve to a different endpoint entirely.
  assert.equal(valid.osuBeatmapId("../../users/2"), null);
  assert.equal(valid.osuBeatmapId("1/../users/2"), null);
  assert.equal(valid.osuBeatmapId("2?key=x"), null);
  assert.equal(valid.osuBeatmapId(Number.MAX_SAFE_INTEGER + 10), null);
});

test("beatmapSubmission() requires a title and a real URL", () => {
  assert.match(valid.beatmapSubmission({ url: "https://osu.ppy.sh/b/1" }).error, /title/i);
  assert.match(valid.beatmapSubmission({ title: "Blue Zenith" }).error, /URL/i);
  assert.match(
    valid.beatmapSubmission({ title: "Blue Zenith", url: "javascript:alert(1)" }).error,
    /http/i
  );
});

test("beatmapSubmission() normalises a full body", () => {
  const { fields, error } = valid.beatmapSubmission({
    title: "  Blue Zenith  ",
    url: "https://osu.ppy.sh/beatmapsets/292301#osu/658127",
    stars: 7.89,
    cs: "4",
    ar: "9.5",
    od: "9",
    bpm: "200",
    length: "4:17",
    slot: " HR1 ",
    mod: "HR",
    skill: "stamina",
    notes: "n".repeat(2000),
    cover_url: "https://assets.ppy.sh/beatmaps/292301/covers/cover.jpg",
    preview_url: "/",
    type: "suggestion",
  });

  assert.equal(error, undefined);
  assert.equal(fields.title, "Blue Zenith");
  assert.equal(fields.stars, "7.89");
  assert.equal(fields.slot, "HR1");
  assert.equal(fields.notes.length, valid.LIMITS.notes);
  assert.equal(fields.cover_url, "https://assets.ppy.sh/beatmaps/292301/covers/cover.jpg");
  assert.equal(fields.preview_url, null, "the '/' placeholder is not a usable preview");
  assert.equal(fields.type, "suggestion");
});

test("beatmapSubmission() only ever yields a known type", () => {
  const body = { title: "t", url: "https://osu.ppy.sh/b/1" };
  assert.equal(valid.beatmapSubmission(body).fields.type, "bounty");
  assert.equal(valid.beatmapSubmission({ ...body, type: "bounty" }).fields.type, "bounty");
  // Anything unrecognised falls back to "bounty" rather than reaching the column.
  assert.equal(valid.beatmapSubmission({ ...body, type: "admin" }).fields.type, "bounty");
  assert.equal(valid.beatmapSubmission({ ...body, type: { a: 1 } }).fields.type, "bounty");
});

test("beatmapSubmission() tolerates a missing body", () => {
  assert.ok(valid.beatmapSubmission().error);
  assert.ok(valid.beatmapSubmission({}).error);
});

test("commentBody() keeps the author's paragraphs and tidies around them", () => {
  assert.equal(valid.commentBody("  a real point  "), "a real point");
  // Windows textareas post CRLF; the column shouldn't collect stray \r.
  assert.equal(valid.commentBody("line one\r\nline two"), "line one\nline two");
  assert.equal(valid.commentBody("one   \ntwo\t"), "one\ntwo");
  // One blank line between paragraphs is punctuation. Twelve is a battering
  // ram for the top of the thread.
  assert.equal(valid.commentBody("first\n\nsecond"), "first\n\nsecond");
  assert.equal(valid.commentBody("first\n\n\n\n\nsecond"), "first\n\nsecond");
  assert.equal(valid.commentBody("\n\n\n"), null);
  assert.equal(valid.commentBody("   "), null);
  assert.equal(valid.commentBody(""), null);
  assert.equal(valid.commentBody(null), null);
  assert.equal(valid.commentBody(undefined), null);
});

test("commentBody() refuses structure and caps the length", () => {
  assert.equal(valid.commentBody({ toString: () => "evil" }), null);
  assert.equal(valid.commentBody(["a"]), null);
  assert.equal(valid.commentBody("x".repeat(2000)).length, valid.LIMITS.commentBody);
  assert.equal(valid.commentBody("hi", 1), "h");
});

test("commentBody() leaves markup alone, because the body is never HTML", () => {
  // Escaping here would show the reader "&lt;b&gt;" — React renders the body
  // as a text node, so angle brackets are just characters someone typed.
  assert.equal(valid.commentBody("<b>DT</b> makes it unreadable"), "<b>DT</b> makes it unreadable");
});

test("countryCode() normalises a two-letter code and rejects the rest", () => {
  assert.equal(valid.countryCode("DZ"), "DZ");
  assert.equal(valid.countryCode("dz"), "DZ");
  assert.equal(valid.countryCode("  dZ  "), "DZ");
  // Anything that isn't exactly two letters is null, because null means "not
  // eligible to vote" and a guess here would hand someone else's vote out.
  assert.equal(valid.countryCode("DZA"), null);
  assert.equal(valid.countryCode("D"), null);
  assert.equal(valid.countryCode("D Z"), null);
  assert.equal(valid.countryCode("D-Z"), null);
  assert.equal(valid.countryCode("12"), null);
  assert.equal(valid.countryCode(""), null);
  assert.equal(valid.countryCode("   "), null);
  assert.equal(valid.countryCode(null), null);
  assert.equal(valid.countryCode(undefined), null);
});

test("countryCode() refuses structure", () => {
  // osu! reports the country in two shapes and one of them is an object; this
  // makes reading the wrong one fail loudly rather than storing "[object ...".
  assert.equal(valid.countryCode({ code: "DZ" }), null);
  assert.equal(valid.countryCode(["DZ"]), null);
  assert.equal(valid.countryCode({ toString: () => "DZ" }), null);
});

test("countryList() parses the allowlist and drops the noise", () => {
  assert.deepEqual(valid.countryList("DZ"), ["DZ"]);
  assert.deepEqual(valid.countryList("dz, fr"), ["DZ", "FR"]);
  assert.deepEqual(valid.countryList(" dz ,, fr , "), ["DZ", "FR"]);
  // A stray comma must not add "" to the list — an empty entry that matched
  // an empty country_code would let unknown accounts through.
  assert.deepEqual(valid.countryList(","), []);
  assert.deepEqual(valid.countryList(""), []);
  assert.deepEqual(valid.countryList(null), []);
  assert.deepEqual(valid.countryList(undefined), []);
  assert.deepEqual(valid.countryList("algeria"), []);
  // Duplicates collapse, so "dz,DZ" doesn't make the includes() check slower
  // or the label read "Algeria, Algeria".
  assert.deepEqual(valid.countryList("dz,DZ, dz"), ["DZ"]);
});
