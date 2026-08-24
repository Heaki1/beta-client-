// Unit tests for lib/returnTo.js — the allowlist that decides where a
// sign-in is allowed to land. Run with `npm test` (no database, no server).
//
// Most of this file is hostile input. That's the point: the function exists
// to stop our own /api/auth/osu/login from being used to bounce someone to
// another site, so the interesting cases are all the ways a string can look
// like a local path without being one.
const test = require("node:test");
const assert = require("node:assert/strict");

const returnTo = require("../lib/returnTo");

test("safePath() keeps the pages the site actually serves", () => {
  assert.equal(returnTo.safePath("/"), "/");
  assert.equal(returnTo.safePath("/vote"), "/vote");
  assert.equal(returnTo.safePath("/community"), "/community");
  assert.equal(returnTo.safePath("/admin"), "/admin");
  // Surrounding whitespace is a copy-paste artefact, not an attack.
  assert.equal(returnTo.safePath("  /vote  "), "/vote");
});

test("safePath() refuses anything that would leave the site", () => {
  // Each of these passes a naive "starts with a slash" check, and each one
  // sends the browser somewhere else.
  for (const hostile of [
    "//evil.com",
    "///evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "/%2f%2fevil.com",
    "https://evil.com",
    "http://evil.com/vote",
    "//evil.com/vote",
    "/vote/../../evil",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
  ]) {
    assert.equal(returnTo.safePath(hostile), "/vote", `${hostile} must not survive`);
  }
});

test("safePath() falls back for a path that is merely close", () => {
  // Exact match only. A trailing slash or a query string means we don't
  // recognise it, and not recognising it means the default.
  for (const near of ["/vote/", "/VOTE", "/Vote", "/vote?x=1", "/vote#top", "/votes", "vote", "", "   "]) {
    assert.equal(returnTo.safePath(near), "/vote", `${JSON.stringify(near)} should fall back`);
  }
});

test("safePath() falls back for anything that isn't a string", () => {
  // ?next= arrives from a query string, where Express hands back an array for
  // a repeated parameter and an object for `next[a]=b`. Neither may be
  // stringified into the redirect.
  for (const junk of [null, undefined, 123, true, {}, ["/vote"], { toString: () => "/" }]) {
    assert.equal(returnTo.safePath(junk), "/vote", `${JSON.stringify(junk)} should fall back`);
  }
});

test("every answer safePath() gives is one of the known pages", () => {
  // The invariant the callers rely on: whatever goes in, what comes out is a
  // path this server has a route for.
  for (const input of ["/", "/vote", "//evil.com", "/nope", null, 7, ["/"], "/admin"]) {
    assert.ok(
      returnTo.PAGES.includes(returnTo.safePath(input)),
      `${JSON.stringify(input)} produced a path that isn't on the list`
    );
  }
  assert.ok(returnTo.PAGES.includes(returnTo.DEFAULT_PAGE));
});

test("withLoginError() returns to the right page with an encoded reason", () => {
  assert.equal(returnTo.withLoginError("/", "bad_state"), "/?login_error=bad_state");
  assert.equal(returnTo.withLoginError("/vote", "exchange_failed"), "/vote?login_error=exchange_failed");
  // The reason is whatever osu! put in ?error=, so it gets encoded rather
  // than trusted — otherwise it could add its own parameters, or a fragment
  // that hides the rest of the URL.
  assert.equal(returnTo.withLoginError("/", "a&b=c"), "/?login_error=a%26b%3Dc");
  assert.equal(returnTo.withLoginError("/", "two words"), "/?login_error=two%20words");
  assert.equal(returnTo.withLoginError("/", "#frag"), "/?login_error=%23frag");
  // A hostile destination is still refused, even on the failure path.
  assert.equal(returnTo.withLoginError("//evil.com", "bad_state"), "/vote?login_error=bad_state");
  // And a missing reason still produces a usable URL rather than "undefined"
  // arriving as a bare word the page would try to look up.
  assert.equal(returnTo.withLoginError("/", undefined), "/?login_error=unknown");
});
