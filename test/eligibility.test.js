// Unit tests for lib/eligibility.js — the rule that decides whose vote counts.
// Run with `npm test` (no database, no server).
//
// Every case passes an explicit env object rather than touching process.env,
// so these tests can't leak a configuration into whatever runs after them.
const test = require("node:test");
const assert = require("node:assert/strict");

const eligibility = require("../lib/eligibility");

const dz = { country_code: "DZ" };
const fr = { country_code: "FR" };
const unknown = { country_code: null };

test("canVote() lets an Algerian player vote and nobody else, by default", () => {
  const env = {};
  assert.equal(eligibility.canVote(dz, env), true);
  assert.equal(eligibility.canVote(fr, env), false);
  // Lowercase from a hand-written cookie or an older row still counts: the
  // code is normalised, not compared raw.
  assert.equal(eligibility.canVote({ country_code: "dz" }, env), true);
  assert.equal(eligibility.canVote({ country_code: " Dz " }, env), true);
});

test("canVote() treats a missing country as not eligible", () => {
  const env = {};
  // This is the case every pre-existing account is in until it signs in again.
  // It has to fail closed: a session with no country must not be able to vote
  // just because we don't know where its owner is from.
  assert.equal(eligibility.canVote(unknown, env), false);
  assert.equal(eligibility.canVote({}, env), false);
  assert.equal(eligibility.canVote({ country_code: "" }, env), false);
  assert.equal(eligibility.canVote(null, env), false);
  assert.equal(eligibility.canVote(undefined, env), false);
});

test("canVote() ignores a country that isn't a country code", () => {
  const env = {};
  // A forged cookie can say anything. None of these may resolve to eligible,
  // and in particular a prefix of an allowed code must not pass.
  assert.equal(eligibility.canVote({ country_code: "DZZ" }, env), false);
  assert.equal(eligibility.canVote({ country_code: "D" }, env), false);
  assert.equal(eligibility.canVote({ country_code: "D Z" }, env), false);
  assert.equal(eligibility.canVote({ country_code: "*" }, env), false);
  assert.equal(eligibility.canVote({ country_code: ["DZ"] }, env), false);
  assert.equal(eligibility.canVote({ country_code: { code: "DZ" } }, env), false);
  assert.equal(eligibility.canVote({ country_code: true }, env), false);
});

test("VOTER_COUNTRIES widens the allowlist", () => {
  const env = { VOTER_COUNTRIES: "dz, fr" };
  assert.deepEqual(eligibility.allowedCountries(env), ["DZ", "FR"]);
  assert.equal(eligibility.canVote(dz, env), true);
  assert.equal(eligibility.canVote(fr, env), true);
  assert.equal(eligibility.canVote({ country_code: "TN" }, env), false);
  assert.equal(eligibility.canVote(unknown, env), false);
});

test("a broken VOTER_COUNTRIES falls back to DZ, never to everyone", () => {
  // The failure mode that matters: a typo in the environment must narrow the
  // ballot back to the default, not open it up.
  for (const VOTER_COUNTRIES of ["", "   ", ",", ",,,", "DZZ", "algeria", "12"]) {
    const env = { VOTER_COUNTRIES };
    assert.deepEqual(
      eligibility.allowedCountries(env),
      ["DZ"],
      `${JSON.stringify(VOTER_COUNTRIES)} should fall back to DZ`
    );
    assert.equal(eligibility.canVote(fr, env), false);
  }
  // ...and so must an absent one.
  assert.deepEqual(eligibility.allowedCountries({}), ["DZ"]);
});

test("VOTER_COUNTRIES=any switches the rule off, and only those spellings do", () => {
  // This is the documented escape hatch for testing the ballot from outside
  // Algeria, so it needs to actually work...
  for (const VOTER_COUNTRIES of ["any", "ANY", " Any ", "all", "*"]) {
    const env = { VOTER_COUNTRIES };
    assert.equal(eligibility.countryRuleDisabled(env), true, `${VOTER_COUNTRIES} should disable`);
    assert.equal(eligibility.canVote(fr, env), true);
    assert.equal(eligibility.canVote(unknown, env), true);
  }
  // ...and nothing else may trip it, least of all an empty value.
  for (const VOTER_COUNTRIES of ["", "anything", "any,DZ", "none", "false"]) {
    assert.equal(
      eligibility.countryRuleDisabled({ VOTER_COUNTRIES }),
      false,
      `${JSON.stringify(VOTER_COUNTRIES)} should not disable`
    );
  }
  assert.equal(eligibility.countryRuleDisabled({}), false);
});

test("the rule off still means signed out can't vote", () => {
  // "No country restriction" is not "no sign-in": the vote is still keyed on
  // one osu! account.
  assert.equal(eligibility.canVote(null, { VOTER_COUNTRIES: "any" }), false);
});

test("allowedCountryLabel() names the country when it can", () => {
  assert.equal(eligibility.allowedCountryLabel({}), "Algeria");
  assert.equal(eligibility.allowedCountryLabel({ VOTER_COUNTRIES: "dz" }), "Algeria");
  // No name on file, so the code itself is the honest answer.
  assert.equal(eligibility.allowedCountryLabel({ VOTER_COUNTRIES: "fr" }), "FR");
  assert.equal(eligibility.allowedCountryLabel({ VOTER_COUNTRIES: "dz,fr" }), "Algeria, FR");
});

test("publicCountryLabel() goes quiet when the rule is off", () => {
  // The list still says DZ with VOTER_COUNTRIES=any — it's just not being
  // enforced — so this is what the UI has to use, or the page ends up
  // advertising a restriction that nothing is applying.
  assert.equal(eligibility.publicCountryLabel({}), "Algeria");
  assert.equal(eligibility.publicCountryLabel({ VOTER_COUNTRIES: "dz,fr" }), "Algeria, FR");
  assert.equal(eligibility.publicCountryLabel({ VOTER_COUNTRIES: "any" }), null);
  assert.equal(eligibility.publicCountryLabel({ VOTER_COUNTRIES: "*" }), null);
  // Belt and braces: whenever there's no label there must be no refusal, and
  // whenever the rule bites there must be something to show for it. Checked
  // with a code that's on none of these lists, so the only thing that can
  // let it vote is the rule being switched off.
  for (const VOTER_COUNTRIES of ["", "dz", "any", "all", "*", "DZZ", "dz,fr"]) {
    const env = { VOTER_COUNTRIES };
    const label = eligibility.publicCountryLabel(env);
    assert.equal(
      label === null,
      eligibility.canVote({ country_code: "ZZ" }, env),
      `label and enforcement disagree for ${JSON.stringify(VOTER_COUNTRIES)}`
    );
  }
});

test("refusalReason() distinguishes the wrong flag from a missing one", () => {
  const env = {};
  // A wrong flag is final, and the message says so.
  assert.match(eligibility.refusalReason(fr, env), /Algeria/);
  assert.doesNotMatch(eligibility.refusalReason(fr, env), /sign in again/i);
  // A missing one is usually a stale cookie, so it points at the fix.
  assert.match(eligibility.refusalReason(unknown, env), /sign in again/i);
  assert.match(eligibility.refusalReason({ country_code: "DZZ" }, env), /sign in again/i);
  assert.match(eligibility.refusalReason(null, env), /Sign in with osu!/);
});
