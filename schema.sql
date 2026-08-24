-- =====================================================================
-- osu!dz — full schema
-- Base tables (users / beatmaps / votes / comments) + osu! identity
-- + monthly "challenge" voting (one vote per osu! account)
-- + threaded discussion on the maps in a round.
--
-- Idempotent: safe to run on an empty database OR on the live one.
-- Every statement is IF NOT EXISTS, so nothing here touches existing rows.
-- Run with:  npm run migrate
-- =====================================================================

-- 0) Base tables ------------------------------------------------------
--    These already exist on the live database; the guards make a fresh
--    database (a new Render Postgres, or a local one) work too.
--    Note: stars / cs / ar / od / bpm / length are TEXT on purpose — the
--    submit forms post strings and sometimes literally "N/A".
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,            -- uuid string
  display_name TEXT NOT NULL,
  is_admin     BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS beatmaps (
  id           SERIAL PRIMARY KEY,
  title        TEXT NOT NULL,
  url          TEXT NOT NULL,
  stars        TEXT,
  cs           TEXT,
  ar           TEXT,
  od           TEXT,
  bpm          TEXT,
  length       TEXT,
  slot         TEXT,
  mod          TEXT,
  skill        TEXT,
  notes        TEXT,
  cover_url    TEXT,
  preview_url  TEXT,
  type         TEXT DEFAULT 'bounty',       -- 'bounty' | 'suggestion'
  submitted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- The old up/down votes on /community (separate from challenge voting).
CREATE TABLE IF NOT EXISTS votes (
  id         SERIAL PRIMARY KEY,
  beatmap_id INTEGER NOT NULL REFERENCES beatmaps(id) ON DELETE CASCADE,
  user_id    TEXT    NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  vote_type  TEXT    NOT NULL,              -- 'upvote' | 'downvote'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (beatmap_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id           SERIAL PRIMARY KEY,
  beatmap_id   INTEGER NOT NULL REFERENCES beatmaps(id) ON DELETE CASCADE,
  user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  display_name TEXT,
  comment_text TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_beatmaps_created  ON beatmaps (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_beatmap  ON comments (beatmap_id);
-- No separate index on votes(beatmap_id): the UNIQUE (beatmap_id, user_id)
-- constraint above already builds one whose leading column is beatmap_id, and
-- Postgres uses it for beatmap_id-only lookups. A second index would only add
-- write cost. (Live databases created before this note still have an
-- idx_votes_beatmap; it's harmless, just redundant.)

-- 1) Extend users with osu! identity ----------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS osu_id     BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS username   TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin   BOOLEAN DEFAULT FALSE;
-- ISO 3166-1 alpha-2 from the osu! profile ('DZ'), refreshed on every login.
-- Eligibility to vote is read from this, so it is deliberately not editable by
-- the account it describes — it only ever arrives from osu! itself.
-- NULL means "we haven't seen this account sign in since the column existed",
-- which is treated as not eligible; see lib/eligibility.js.
ALTER TABLE users ADD COLUMN IF NOT EXISTS country_code TEXT;

-- One app user per osu! account. A unique *index* rather than a named
-- constraint: CREATE UNIQUE INDEX IF NOT EXISTS is idempotent on its own,
-- and it still works as an ON CONFLICT (osu_id) arbiter. Multiple NULLs are
-- allowed, so pre-osu! users (who signed up with just a display name) are fine.
CREATE UNIQUE INDEX IF NOT EXISTS users_osu_id_key ON users (osu_id);

-- 2) Challenges = monthly voting rounds -------------------------------
--    status: 'draft'   = admin is preparing it (hidden from players)
--            'open'    = voting is live
--            'closed'  = voting ended (winner shown)
CREATE TABLE IF NOT EXISTS challenges (
  id                SERIAL PRIMARY KEY,
  month             TEXT,                                  -- e.g. '2026-09'
  title             TEXT NOT NULL,
  bounty            TEXT,                                  -- free text: "$50 + role"
  status            TEXT NOT NULL DEFAULT 'draft',
  winner_beatmap_id INTEGER REFERENCES beatmaps(id) ON DELETE SET NULL,
  closes_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- 3) Which beatmaps are candidates in a given challenge ---------------
CREATE TABLE IF NOT EXISTS challenge_candidates (
  challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  beatmap_id   INTEGER NOT NULL REFERENCES beatmaps(id)   ON DELETE CASCADE,
  added_at     TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (challenge_id, beatmap_id)
);

-- 4) Votes: EXACTLY ONE per osu! user per challenge -------------------
--    The composite PK is the hard guarantee of "one vote per user".
CREATE TABLE IF NOT EXISTS challenge_votes (
  challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  osu_id       BIGINT  NOT NULL,
  beatmap_id   INTEGER NOT NULL REFERENCES beatmaps(id)   ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (challenge_id, osu_id)
);

CREATE INDEX IF NOT EXISTS idx_challenge_votes_tally
  ON challenge_votes (challenge_id, beatmap_id);
CREATE INDEX IF NOT EXISTS idx_challenge_candidates_challenge
  ON challenge_candidates (challenge_id);

-- 5) Indexes for the queries the site actually runs ---------------------
--    /api/beatmaps/list?type= filters on type and orders by created_at;
--    the comment list pages by (beatmap_id, created_at); challenge_votes is
--    read by osu_id when working out "what did I vote for". The old up/down
--    vote lookup needs nothing new — see the note in section 0.
CREATE INDEX IF NOT EXISTS idx_beatmaps_type_created
  ON beatmaps (type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_beatmaps_submitted_by
  ON beatmaps (submitted_by);
CREATE INDEX IF NOT EXISTS idx_comments_beatmap_created
  ON comments (beatmap_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_challenge_votes_osu
  ON challenge_votes (osu_id);
-- Only one round may be 'open' at a time. The application refuses to open a
-- second one, but this makes it true even if two admins click at once.
CREATE UNIQUE INDEX IF NOT EXISTS challenges_single_open
  ON challenges ((status)) WHERE status = 'open';

-- 6) Discussion on the maps that are up for a vote --------------------
--    Deliberately NOT the `comments` table from section 0. That one belongs
--    to /community and trusts a client-supplied display_name, so anyone can
--    post as anyone. These are keyed on osu_id from the session cookie —
--    the same identity that owns a vote — and scoped to a round, so last
--    month's argument doesn't reappear under this month's ballot.
--
--    Authorship is osu_id rather than users.id for the reason spelled out in
--    auth.js: a users row can be re-created with a fresh uuid, but the osu!
--    account is the identity that actually persists. The username and avatar
--    shown next to a comment are joined from `users` at read time, so they
--    follow renames instead of freezing whatever was current at post time.
CREATE TABLE IF NOT EXISTS challenge_comments (
  id           SERIAL PRIMARY KEY,
  challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  beatmap_id   INTEGER NOT NULL REFERENCES beatmaps(id)   ON DELETE CASCADE,
  -- NULL = a top-level comment. Replies point at one. Threads are one level
  -- deep: the API re-parents a reply-to-a-reply onto the top comment rather
  -- than refusing it, so this column never forms a chain. That's an
  -- application rule — a CHECK can't see the parent's own parent_id.
  parent_id    INTEGER REFERENCES challenge_comments(id) ON DELETE CASCADE,
  osu_id       BIGINT  NOT NULL,
  body         TEXT    NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at    TIMESTAMPTZ,
  -- Set instead of deleting the row when the comment has replies, so removing
  -- one doesn't take the conversation under it with it. The API renders these
  -- as "[deleted]" and never returns `body` for them. Note the text does stay
  -- in the column: it's what lets you answer an abuse report after the author
  -- has tidied up. A tombstone whose last reply goes away is deleted for real.
  deleted_at   TIMESTAMPTZ
);

-- The thread read is (challenge_id, beatmap_id) ordered by created_at, and
-- ASC matters: a reply is always newer than its parent, so taking the oldest
-- N rows can never hand back a reply whose parent got cut off.
CREATE INDEX IF NOT EXISTS idx_challenge_comments_thread
  ON challenge_comments (challenge_id, beatmap_id, created_at);
-- Counting a comment's live replies before deleting it, and cascading.
CREATE INDEX IF NOT EXISTS idx_challenge_comments_parent
  ON challenge_comments (parent_id);
-- The per-card "N comments" badge counts live rows per map in one round.
CREATE INDEX IF NOT EXISTS idx_challenge_comments_count
  ON challenge_comments (challenge_id, beatmap_id) WHERE deleted_at IS NULL;

-- 7) Beatmap metadata the ballot card puts on its face -----------------
--    The card design on /vote shows the song, the artist, the mapper and the
--    difficulty name as four separate lines, plus HP drain alongside the other
--    four difficulty settings. Only the composite `title` existed before —
--    "Artist - Song [Difficulty]", one string, built by the osu! proxy — which
--    can't be split reliably after the fact once someone has hand-edited it.
--
--    So the parts are stored as well as the whole. `title` stays exactly as it
--    was: it's what the Discord embed, /community and the old bounty list all
--    read, and it's the field a submitter can retype. These four come only
--    from the osu! API lookup, and are NULL on every row submitted before this
--    section existed — the card falls back to `title` for those, which is what
--    it showed anyway.
ALTER TABLE beatmaps ADD COLUMN IF NOT EXISTS artist          TEXT;
ALTER TABLE beatmaps ADD COLUMN IF NOT EXISTS mapper          TEXT;
-- The osu! API calls this `version`; "difficulty_name" is what players call it
-- and what the card labels it, so the column says that instead.
ALTER TABLE beatmaps ADD COLUMN IF NOT EXISTS difficulty_name TEXT;
-- TEXT like stars/cs/ar/od, not NUMERIC: these columns hold whatever the
-- lookup returned, including the literal "N/A" for a map the API answered
-- without. Making this one numeric would be the only stat that can't.
ALTER TABLE beatmaps ADD COLUMN IF NOT EXISTS hp              TEXT;
