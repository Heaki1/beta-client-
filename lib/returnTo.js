// =====================================================================
// Where to send someone after they sign in with osu!.
//
// Sign-in can now start from more than one page — the ballot on /vote and
// the bounty form on / — so the destination travels through the OAuth round
// trip. That makes this an open-redirect question, which is why it is its
// own pure, unit-tested file rather than three lines inside the route.
//
// It is an allowlist of literal paths on purpose. The usual shortcut is
// "must start with a slash", and the usual bug is that `//evil.com` and
// `/\evil.com` both start with a slash and both send the browser off-site
// with our sign-in as the referrer. Four exact strings cannot be wrong.
// =====================================================================

// Every page the site actually serves (see the route table at the bottom of
// server.js). A new page has to be added here before sign-in can return to
// it — the failure mode is landing on /vote, which is merely annoying.
const PAGES = Object.freeze(["/", "/vote", "/community", "/admin"]);

// Where an unrecognised or absent destination lands. /vote is the page that
// most needs a session, and it was the only destination before this existed.
const DEFAULT_PAGE = "/vote";

// Note what is *not* done here: no decoding, no unescaping, no normalising.
// Anything that isn't already exactly one of the four strings is thrown away,
// so there is no clever encoding of "evil.com" that survives.
function safePath(value) {
  if (typeof value !== "string") return DEFAULT_PAGE;
  const path = value.trim();
  return PAGES.includes(path) ? path : DEFAULT_PAGE;
}

// The URL to bounce a failed sign-in to: the page it started from, carrying a
// reason the page can show. Built here so the reason is encoded once, in the
// same place the path is vetted.
function withLoginError(value, reason) {
  return `${safePath(value)}?login_error=${encodeURIComponent(String(reason ?? "unknown"))}`;
}

module.exports = { PAGES, DEFAULT_PAGE, safePath, withLoginError };
