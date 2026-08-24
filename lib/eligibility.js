// =====================================================================
// Who is allowed to vote.
//
// Pure, and in its own file rather than inside auth.js on purpose: this is
// the rule that decides whose vote counts, so it's the part most worth
// having tests for, and auth.js can't be required from a test without
// dragging a database pool along with it.
//
// Every function takes the environment as an argument (defaulting to the
// real one) so a test can describe a configuration without mutating
// process.env and leaking it into whatever runs next.
// =====================================================================
const valid = require("./validate");

// Where the ballot lands when VOTER_COUNTRIES says nothing usable. osu!dz is
// an Algerian community site — DZ is the point of the feature, not a stand-in.
// Frozen, and copied on the way out of allowedCountries(), so a caller that
// pushes onto the returned array can't widen the allowlist for the whole
// process. Nothing does that today; it's a cheap thing to make impossible.
const DEFAULT_COUNTRIES = Object.freeze(["DZ"]);

// Only DZ needs a friendly name today. Anything else falls back to the raw
// code so the message stays truthful if the allowlist is ever widened.
const COUNTRY_NAMES = { DZ: "Algeria" };

// The spellings that switch the rule off. It has to be one of these words:
// an unset or empty VOTER_COUNTRIES means "use the default", never "no rule",
// so a missing environment variable can't quietly open the ballot to the world.
const DISABLED_WORDS = new Set(["any", "all", "*"]);

function countryRuleDisabled(env = process.env) {
  return DISABLED_WORDS.has(
    String(env.VOTER_COUNTRIES || "")
      .trim()
      .toLowerCase()
  );
}

// The allowlist, as country codes. Note what happens to a typo: "DZZ" parses
// to nothing, so the list is empty, so we fall back to DZ. Failing to the
// default rather than to "everyone" is the whole reason this isn't inline.
function allowedCountries(env = process.env) {
  const configured = valid.countryList(env.VOTER_COUNTRIES);
  return configured.length ? configured : [...DEFAULT_COUNTRIES];
}

// "Algeria", or the bare codes once the allowlist grows past the one country
// we have a name for. This answers "what is on the list", which is not the
// same question as "what should a player be told" — see publicCountryLabel.
function allowedCountryLabel(env = process.env) {
  return allowedCountries(env)
    .map((code) => COUNTRY_NAMES[code] || code)
    .join(", ");
}

// The label to show players, or null when there is no restriction to describe.
// Separate from allowedCountryLabel() because that one still reports DZ while
// VOTER_COUNTRIES=any — the list survives, it just isn't being enforced — and
// putting that on the page would advertise a rule that isn't running.
function publicCountryLabel(env = process.env) {
  return countryRuleDisabled(env) ? null : allowedCountryLabel(env);
}

// The session's country came from osu! at sign-in. It's re-normalised here
// rather than trusted, because it reaches us through a cookie.
//
// No admin exemption, deliberately: an admin who wants to vote from elsewhere
// widens VOTER_COUNTRIES, where the change is visible to anyone reading the
// config, instead of relying on a branch in the code that nobody checking the
// results can see. A missing country is "not eligible", not "eligible".
function canVote(session, env = process.env) {
  if (!session) return false;
  if (countryRuleDisabled(env)) return true;
  const code = valid.countryCode(session.country_code);
  return code !== null && allowedCountries(env).includes(code);
}

// Why the vote was refused, phrased as something the reader can act on. The
// two cases are genuinely different: a wrong flag is final, while a missing
// one is usually a stale session and fixes itself on the next sign-in.
function refusalReason(session, env = process.env) {
  if (!session) return "Sign in with osu! first";
  if (valid.countryCode(session.country_code)) {
    return `Voting is open to players with the ${allowedCountryLabel(env)} flag on their osu! profile.`;
  }
  return "We couldn't read the country on your osu! profile. Sign out, sign in again, then try once more.";
}

module.exports = {
  DEFAULT_COUNTRIES,
  COUNTRY_NAMES,
  countryRuleDisabled,
  allowedCountries,
  allowedCountryLabel,
  publicCountryLabel,
  canVote,
  refusalReason,
};
