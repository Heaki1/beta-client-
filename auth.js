// =====================================================================
// Identity for osu!dz — osu! OAuth session + admin allowlist.
//
// The session is a signed JWT in an httpOnly cookie. Nothing is stored
// server-side, so Render restarts don't log anyone out and there is no
// session table to maintain.
//
// Admin = your osu! user id listed in ADMIN_OSU_IDS (comma separated),
// or users.is_admin = true in the database. Log in with osu! and the
// admin panel appears — there is no admin password to leak.
//
// Voting is limited to the countries in VOTER_COUNTRIES (default DZ),
// read from the osu! profile at sign-in. There is no admin exemption:
// the rule is the rule. VOTER_COUNTRIES=any turns it off, which is the
// intended way to test the ballot from outside Algeria.
//
// Sign-in can be started from any page (/vote and / both offer it) and
// osu! only knows one redirect_uri, so the page to come back to is kept
// in a short-lived cookie — see setReturnCookie / lib/returnTo.js.
// =====================================================================
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const db = require("./database");
const valid = require("./lib/validate");
const eligibility = require("./lib/eligibility");
const returnTo = require("./lib/returnTo");

const SESSION_COOKIE = "osu_dz_session";
const STATE_COOKIE = "osu_dz_oauth_state";
const RETURN_COOKIE = "osu_dz_oauth_return";
const SESSION_DAYS = 30;

// Bumped when a session needs to carry something it didn't before, so old
// cookies stop being accepted instead of being trusted with a field they
// don't have. Version 2 added country_code: a version-1 cookie has no
// country, and silently treating that as "no country" would have locked
// every signed-in player out of voting until their cookie expired 30 days
// later. Raising this logs everyone out once, which is the cheap fix.
const SESSION_VERSION = 2;

// Cookies are only marked Secure when we're actually served over https.
// Deriving this from PUBLIC_BASE_URL (instead of NODE_ENV) means login works
// on http://localhost without asking you to set NODE_ENV=development.
function publicBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

function isSecureContext() {
  return publicBaseUrl().startsWith("https://");
}

function adminOsuIds() {
  return String(process.env.ADMIN_OSU_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// True only when every piece needed for "Sign in with osu!" is present.
function isAuthConfigured() {
  return Boolean(
    process.env.OSU_CLIENT_ID &&
      process.env.OSU_CLIENT_SECRET &&
      process.env.OSU_REDIRECT_URI &&
      process.env.SESSION_SECRET
  );
}

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return secret;
}

// ---------- session cookie ----------

function signSession(payload) {
  // `v` is stamped here rather than by whoever calls this, so a future second
  // sign-in path can't forget it and mint a cookie that reads as an old one.
  return jwt.sign({ ...payload, v: SESSION_VERSION }, sessionSecret(), {
    algorithm: "HS256",
    expiresIn: `${SESSION_DAYS}d`,
  });
}

function setSessionCookie(res, payload) {
  res.cookie(SESSION_COOKIE, signSession(payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureContext(),
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: "/", sameSite: "lax", secure: isSecureContext() });
}

// Returns { user_id, osu_id, username, avatar_url, country_code } or null.
function readSession(req) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token || !process.env.SESSION_SECRET) return null;
  try {
    // Pinning the algorithm means a forged "alg" header can't talk us into
    // verifying the token a different way.
    const claims = jwt.verify(token, sessionSecret(), { algorithms: ["HS256"] });
    if (!claims?.osu_id) return null;
    // A cookie from an older version counts as no session at all. The browser
    // is holding a token that's missing a field we now make decisions with,
    // and one trip through osu! is a better fix than a guess about what the
    // missing field would have said.
    if (claims.v !== SESSION_VERSION) return null;
    return {
      user_id: claims.user_id,
      osu_id: String(claims.osu_id),
      username: claims.username,
      avatar_url: claims.avatar_url,
      // Re-normalised on the way out: this claim decides who may vote, and it
      // arrives from a cookie, so it gets the same treatment as any other
      // input rather than being trusted because we signed it.
      country_code: valid.countryCode(claims.country_code),
    };
  } catch {
    return null; // expired, tampered with, or signed by an older SESSION_SECRET
  }
}

// ---------- CSRF state for the OAuth round trip ----------

function setStateCookie(res, state) {
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax", // still sent on the top-level GET redirect back from osu!
    secure: isSecureContext(),
    maxAge: 10 * 60 * 1000,
    path: "/",
  });
}

function readStateCookie(req) {
  return req.cookies?.[STATE_COOKIE] || null;
}

function clearStateCookie(res) {
  res.clearCookie(STATE_COOKIE, { path: "/", sameSite: "lax", secure: isSecureContext() });
}

// ---------- where to go once sign-in finishes ----------
//
// Sign-in starts from the ballot on /vote and from the bounty form on /, and
// osu! sends everyone back to the one registered redirect_uri, so the page
// they came from has to be remembered somewhere. A cookie rather than a query
// parameter on the callback: osu! would echo a parameter back to us verbatim,
// which means anything reachable from that value has to be treated as
// attacker-controlled. Coming out of our own httpOnly cookie it isn't — and
// it's vetted by lib/returnTo anyway, belt and braces.
//
// Same 10 minute life as the state cookie: it belongs to one round trip.

function setReturnCookie(res, next) {
  res.cookie(RETURN_COOKIE, returnTo.safePath(next), {
    httpOnly: true,
    sameSite: "lax", // must survive the top-level GET redirect back from osu!
    secure: isSecureContext(),
    maxAge: 10 * 60 * 1000,
    path: "/",
  });
}

// Reads *and* clears, because a leftover destination from an abandoned sign-in
// shouldn't decide where the next one lands. Always returns a real page path.
function takeReturnPath(req, res) {
  const raw = req.cookies?.[RETURN_COOKIE];
  res.clearCookie(RETURN_COOKIE, { path: "/", sameSite: "lax", secure: isSecureContext() });
  return returnTo.safePath(raw);
}

// ---------- middleware ----------

function requireAuth(req, res, next) {
  const session = readSession(req);
  if (!session) return res.status(401).json({ error: "Sign in with osu! first" });
  req.session = session;
  next();
}

async function isAdmin(session) {
  if (!session) return false;
  if (adminOsuIds().includes(String(session.osu_id))) return true;
  // Fallback so you can promote someone by flipping users.is_admin,
  // without a redeploy. Matched on osu_id as well as the row id: a session
  // cookie outlives the row it was minted from (a re-created user gets a new
  // uuid), and the osu! account is the identity that actually matters.
  try {
    const r = await db.query(
      "SELECT is_admin FROM users WHERE id = $1 OR osu_id = $2 ORDER BY (id = $1) DESC LIMIT 1",
      [session.user_id, session.osu_id]
    );
    return r.rowCount > 0 && r.rows[0].is_admin === true;
  } catch {
    return false;
  }
}

async function requireAdmin(req, res, next) {
  const session = readSession(req);
  if (!session) return res.status(401).json({ error: "Sign in with osu! first" });
  if (!(await isAdmin(session))) return res.status(403).json({ error: "Admins only" });
  req.session = session;
  next();
}

// ---------- who may vote ----------
//
// The rule itself lives in lib/eligibility.js, which is pure and unit tested.
// These are the thin wrappers the routes use, so callers don't have to know
// the rule reads its configuration from the environment. Anything that needs
// the raw allowlist should require lib/eligibility directly.

// null when the rule is switched off — the API sends this straight to the
// client, which uses "is there a label" as "is there a restriction".
const voteCountryLabel = () => eligibility.publicCountryLabel();
const canVote = (session) => eligibility.canVote(session);
const voteRefusalReason = (session) => eligibility.refusalReason(session);

// Like requireAuth, plus the country check. Comments deliberately keep using
// requireAuth: the rule is about deciding the winner, not about who may talk.
function requireVoter(req, res, next) {
  const session = readSession(req);
  if (!session) return res.status(401).json({ error: "Sign in with osu! first" });
  if (!canVote(session)) {
    // `reason` lets the client tell this apart from the other 403s it can get
    // (round closed, map not a candidate) without matching on the message.
    return res.status(403).json({ error: voteRefusalReason(session), reason: "country" });
  }
  req.session = session;
  next();
}

// ---------- users ----------

// osu! reports the country on /me as `country_code`, and again as a nested
// `country: { code, name }`. Reading both means a shift in which one the API
// leads with doesn't silently start storing NULL and taking away every vote.
function countryFromProfile(profile) {
  return valid.countryCode(profile?.country_code ?? profile?.country?.code);
}

// Creates or refreshes the users row for an osu! account and returns it.
// Atomic via ON CONFLICT, so two simultaneous logins can't duplicate a user.
async function upsertOsuUser(profile) {
  const osuId = String(profile.id);
  const username = profile.username || `osu-${osuId}`;
  const avatarUrl = profile.avatar_url || null;
  const countryCode = countryFromProfile(profile);

  const result = await db.query(
    `
    INSERT INTO users (id, display_name, osu_id, username, avatar_url, country_code)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (osu_id) DO UPDATE
      SET username = EXCLUDED.username,
          avatar_url = EXCLUDED.avatar_url,
          -- COALESCE rather than a plain overwrite: if osu! ever answers
          -- without a country, keep the one already stored instead of blanking
          -- it and revoking the account's vote in the middle of a round.
          country_code = COALESCE(EXCLUDED.country_code, users.country_code)
    RETURNING id, display_name, osu_id, username, avatar_url, country_code, is_admin
  `,
    [uuidv4(), username, osuId, username, avatarUrl, countryCode]
  );

  return result.rows[0];
}

module.exports = {
  SESSION_COOKIE,
  STATE_COOKIE,
  RETURN_COOKIE,
  SESSION_VERSION,
  publicBaseUrl,
  isAuthConfigured,
  adminOsuIds,
  signSession,
  setSessionCookie,
  clearSessionCookie,
  readSession,
  setStateCookie,
  readStateCookie,
  clearStateCookie,
  setReturnCookie,
  takeReturnPath,
  requireAuth,
  requireAdmin,
  isAdmin,
  voteCountryLabel,
  canVote,
  voteRefusalReason,
  requireVoter,
  countryFromProfile,
  upsertOsuUser,
};
