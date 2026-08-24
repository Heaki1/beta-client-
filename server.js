const express = require("express");
const axios = require("axios");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();

const db = require("./database");
const auth = require("./auth");
const valid = require("./lib/validate");
const profanity = require("./lib/profanity");
const returnTo = require("./lib/returnTo");
const app = express();
const port = process.env.PORT || 3000;

app.set("trust proxy", 1);

// CSP
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:", "http:"],
        scriptSrc: ["'self'", "'unsafe-inline'"], // tighten later after removing all inline scripts
        connectSrc: ["'self'", "https://osu.ppy.sh", "https://b.ppy.sh", "https://*.onrender.com"],
        mediaSrc: ["'self'", "https:", "http:"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// CORS
//
// The API answers with the session cookie, so reflecting every Origin back
// with credentials:true would let any site on the internet call these
// endpoints as a signed-in visitor. The allowlist is the site's own origin
// plus localhost (so `npm run dev:client` on :5173 keeps working); add more
// with EXTRA_CORS_ORIGINS=https://a.example,https://b.example.
const allowedOrigins = new Set(
  [
    auth.publicBaseUrl(),
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    ...String(process.env.EXTRA_CORS_ORIGINS || "")
      .split(",")
      .map((s) => s.trim().replace(/\/+$/, "")),
  ].filter(Boolean)
);

app.use(
  cors({
    origin: (origin, callback) => {
      // No Origin header = same-origin navigation, curl, or a server-to-server
      // call. Nothing to authorise.
      if (!origin) return callback(null, true);
      if (allowedOrigins.has(origin.replace(/\/+$/, ""))) return callback(null, true);
      // Don't throw: an error here becomes a 500. Answering without the
      // CORS headers is what makes the browser block the read.
      callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-user-id"],
  })
);

app.use(express.json({ limit: "10kb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// Rate limiters
const skipInDev = () => process.env.NODE_ENV === "development";

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInDev,
});

// Anything that writes a row someone else will read (submissions, comments,
// votes, registrations) gets a tighter budget than plain reads, so one script
// can't fill the site with junk inside its 200-request allowance.
const writeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInDev,
});

const discordLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInDev,
});

// Two identity systems answer for this page, and both have to keep working.
//
//   osu! session  — a signed httpOnly cookie. Trustworthy: the browser can't
//                   write it, and it names a real osu! account.
//   x-user-id     — the uuid handed out by /api/users/register, replayed from
//                   localStorage. A bearer token in a header, which is exactly
//                   what it has always been: whoever holds it is the owner.
//
// New submissions are filed under the osu! account when there is one, so the
// site drifts towards verified identities on its own. But the legacy id is
// still accepted for rows that already carry it, because people submitted maps
// before osu! sign-in existed on this page and signing in must not take their
// own maps away from them.
//
// Anything that isn't shaped like an id we issued is treated as absent — which
// closes a hole: `localStorage.getItem()` returns null when the entry is gone,
// fetch sends that as the literal header value "null", and `String(null)` also
// equals the "null" that an orphaned beatmap's submitted_by stringifies to
// (the column is ON DELETE SET NULL). That combination passed the owner check.
function legacyUserId(req) {
  const raw = req.headers["x-user-id"];
  return valid.isUuid(raw) ? String(raw).trim() : null;
}

// Every id this request may act as. Order matters: the first entry is the one
// a new row gets filed under, so the osu! account wins when both are present.
function identities(req) {
  const session = auth.readSession(req);
  return [session?.user_id || null, legacyUserId(req)].filter(Boolean);
}

// Owner of a row, compared safely. A row with no owner belongs to nobody, so
// it can never match, and neither can an empty list of identities.
function isOwner(submittedBy, userId) {
  return Boolean(submittedBy) && Boolean(userId) && String(submittedBy) === String(userId);
}

// True when any of the request's identities owns the row. Matching on either
// is not a widening: the legacy header was already sufficient on its own
// before osu! sign-in existed, and the osu! cookie is strictly stronger.
function ownsRow(submittedBy, ids) {
  return ids.some((id) => isOwner(submittedBy, id));
}

// USER SYSTEM
app.post("/api/users/register", writeLimiter, async (req, res) => {
  const display_name = valid.text(req.body?.display_name, valid.LIMITS.displayName);

  if (!display_name || display_name.length < 3) {
    return res.status(400).json({ error: "Display name must be 3-20 characters" });
  }
  if (await profanity.isProfane(display_name)) {
    return res.status(400).json({ error: "Please choose a different display name" });
  }

  const newId = uuidv4();

  try {
    await db.query("INSERT INTO users (id, display_name) VALUES ($1, $2)", [newId, display_name]);
    console.log(`👤 Registered user: ${display_name} (${newId}) from ${req.ip}`);
    res.json({ id: newId, display_name, is_admin: false });
  } catch (error) {
    console.error("Registration Error:", error);
    res.status(500).json({ error: "Failed to register user" });
  }
});

app.get("/api/users/:id", apiLimiter, async (req, res) => {
  if (!valid.isUuid(req.params.id)) return res.status(404).json({ error: "User not found" });
  try {
    const result = await db.query("SELECT id, display_name, is_admin FROM users WHERE id = $1", [
      req.params.id,
    ]);
    if (result.rowCount === 0) return res.status(404).json({ error: "User not found" });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Database error" });
  }
});

// BEATMAPS

// Every column a submission writes, in one place. The INSERT and the UPDATE
// below both build their placeholder lists from this array, because two
// hand-numbered $1..$20 lists are precisely the thing that ends up filing the
// artist under `mapper` the day a column is added to one statement and not the
// other. The names are hard-coded here and never come from a request, so
// interpolating them into the SQL is safe; the *values* stay parameterised.
const SUBMISSION_COLUMNS = [
  "title",
  "url",
  "artist",
  "mapper",
  "difficulty_name",
  "stars",
  "cs",
  "ar",
  "od",
  "hp",
  "bpm",
  "length",
  "slot",
  "mod",
  "skill",
  "notes",
  "cover_url",
  "preview_url",
  "type",
];

const columnList = () => SUBMISSION_COLUMNS.join(", ");
const placeholderList = () => SUBMISSION_COLUMNS.map((_, i) => `$${i + 1}`).join(", ");
const assignmentList = () => SUBMISSION_COLUMNS.map((column, i) => `${column} = $${i + 1}`).join(", ");
// The parameter after the columns — submitted_by on the insert, the row id on
// the update. Named so neither statement has to spell out the arithmetic.
const NEXT_PARAM = `$${SUBMISSION_COLUMNS.length + 1}`;

app.post("/api/beatmaps/submit", writeLimiter, async (req, res) => {
  const session = auth.readSession(req);

  // Signed in with osu!? Then that's who submitted it, and the body's
  // submitted_by is ignored — it's a field the page fills in from
  // localStorage, so honouring it would let anyone file a bounty under
  // someone else's name just by editing the request.
  const claimedId = session ? session.user_id : req.body?.submitted_by;
  const { submitted_by_name } = req.body || {};

  // "Missing required fields" was the old answer here, which sent people
  // hunting through the form for a field they hadn't filled in — the actual
  // problem is that the browser hasn't identified itself yet.
  if (!claimedId) {
    return res.status(400).json({ error: "Sign in with osu! (or register a display name) first" });
  }

  // Every field is trimmed and length-capped here, so a crafted request can't
  // store 4 MB of text in a "★" column or a javascript: URL in a cover image.
  const { error, fields } = valid.beatmapSubmission(req.body);
  if (error) return res.status(400).json({ error });

  if (fields.notes && (await profanity.isProfane(fields.notes))) {
    return res.status(400).json({ error: "Please reword the notes" });
  }

  try {
    // Resolve the row this submission hangs off. For an osu! session the
    // lookup also matches on osu_id, the way isAdmin() does: a 30-day cookie
    // outlives the row it was minted from, so a stale user_id should find the
    // account's current row instead of quietly creating a second one for it.
    const lookup = session
      ? await db.query(
          "SELECT id FROM users WHERE id = $1 OR osu_id = $2 ORDER BY (id = $1) DESC LIMIT 1",
          [claimedId, session.osu_id]
        )
      : await db.query("SELECT id FROM users WHERE id = $1", [claimedId]);

    let submitted_by = lookup.rows[0]?.id;

    if (!submitted_by) {
      if (session) {
        // The row is gone — deleted while a 30-day cookie was still live. Put
        // it back through the same upsert that sign-in uses, so it returns
        // with its osu_id attached and the next login finds it instead of
        // adding yet another row. Atomic via ON CONFLICT, unlike a plain
        // INSERT here, so two quick submissions can't collide.
        const rebuilt = await auth.upsertOsuUser({
          id: session.osu_id,
          username: session.username,
          avatar_url: session.avatar_url,
          country_code: session.country_code,
        });
        submitted_by = rebuilt.id;
      } else {
        // Self-heal a missing users row — but only for an id we could have
        // issued. Without the uuid check this endpoint would happily create a
        // user row for any string a caller invented.
        if (!valid.isUuid(claimedId)) {
          return res.status(400).json({ error: "Unknown user — please register again" });
        }
        const name = valid.text(submitted_by_name, valid.LIMITS.displayName) || "Unknown User";
        await db.query("INSERT INTO users (id, display_name) VALUES ($1, $2)", [claimedId, name]);
        submitted_by = claimedId;
      }
    }

    const insert = await db.query(
      `
      INSERT INTO beatmaps (${columnList()}, submitted_by)
      VALUES (${placeholderList()}, ${NEXT_PARAM})
      RETURNING id
    `,
      [...SUBMISSION_COLUMNS.map((column) => fields[column]), submitted_by]
    );

    res.json({ success: true, id: insert.rows[0].id });
  } catch (error) {
    console.error("Submit Error:", error);
    res.status(500).json({ error: "Failed to submit beatmap." });
  }
});

// The whole submission list. Capped so the payload can't grow without bound
// as submissions pile up; ?limit= and ?type= narrow it further.
app.get("/api/beatmaps/list", apiLimiter, async (req, res) => {
  const limit = Math.min(valid.positiveInt(req.query.limit) || 500, 500);
  const type = req.query.type === "suggestion" || req.query.type === "bounty" ? req.query.type : null;

  try {
    const result = await db.query(
      `
      SELECT b.*, u.display_name AS submitted_by_name
      FROM beatmaps b
      LEFT JOIN users u ON u.id = b.submitted_by
      WHERE ($1::text IS NULL OR b.type = $1)
      ORDER BY b.created_at DESC
      LIMIT $2
    `,
      [type, limit]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// Owner-only update
app.put("/api/beatmaps/:id", writeLimiter, async (req, res) => {
  const who = identities(req);
  if (!who.length) {
    return res.status(401).json({ error: "Sign in with osu! (or register a name) before editing" });
  }

  const id = valid.positiveInt(req.params.id);
  if (id === null) return res.status(400).json({ error: "Bad beatmap id" });

  const { error, fields } = valid.beatmapSubmission(req.body);
  if (error) return res.status(400).json({ error });

  if (fields.notes && (await profanity.isProfane(fields.notes))) {
    return res.status(400).json({ error: "Please reword the notes" });
  }

  try {
    const existing = await db.query("SELECT submitted_by, type FROM beatmaps WHERE id = $1", [id]);
    if (existing.rowCount === 0) return res.status(404).json({ error: "Map not found" });

    if (!ownsRow(existing.rows[0].submitted_by, who)) {
      return res.status(403).json({ error: "Not allowed (not owner)" });
    }

    // An edit that omits `type` keeps whatever the row already had.
    const safeType = req.body?.type ? fields.type : existing.rows[0].type || "bounty";

    await db.query(
      `
      UPDATE beatmaps
      SET ${assignmentList()}
      WHERE id = ${NEXT_PARAM}
    `,
      [...SUBMISSION_COLUMNS.map((column) => (column === "type" ? safeType : fields[column])), id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Update failed:", err);
    res.status(500).json({ error: "Update failed" });
  }
});

// Owner-only delete
app.delete("/api/beatmaps/:id", writeLimiter, async (req, res) => {
  const who = identities(req);
  if (!who.length) {
    return res.status(401).json({ error: "Sign in with osu! (or register a name) before deleting" });
  }

  const id = valid.positiveInt(req.params.id);
  if (id === null) return res.status(400).json({ error: "Bad beatmap id" });

  try {
    const existing = await db.query("SELECT submitted_by FROM beatmaps WHERE id = $1", [id]);
    if (existing.rowCount === 0) return res.status(404).json({ error: "Map not found" });

    if (!ownsRow(existing.rows[0].submitted_by, who)) {
      return res.status(403).json({ error: "Not allowed (not owner)" });
    }

    await db.query("DELETE FROM beatmaps WHERE id = $1", [id]); // cascades votes/comments if schema uses ON DELETE CASCADE
    res.json({ success: true });
  } catch (err) {
    console.error("Delete failed:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

// VOTES
app.get("/api/beatmaps/:id/votes", apiLimiter, async (req, res) => {
  const beatmapId = valid.positiveInt(req.params.id);
  if (beatmapId === null) return res.status(400).json({ error: "Bad beatmap id" });

  try {
    // One grouped query instead of two COUNT(*) round trips.
    const tally = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE vote_type = 'upvote')::int   AS upvotes,
         COUNT(*) FILTER (WHERE vote_type = 'downvote')::int AS downvotes
       FROM votes WHERE beatmap_id = $1`,
      [beatmapId]
    );

    let userVote = null;
    // Only look up the caller's own vote when the id could be one we issued.
    // The column is TEXT, so a junk value wouldn't error — it would just be a
    // guaranteed-empty query on every card render.
    if (valid.isUuid(req.query.user_id)) {
      const v = await db.query("SELECT vote_type FROM votes WHERE beatmap_id=$1 AND user_id=$2", [
        beatmapId,
        req.query.user_id.trim(),
      ]);
      if (v.rowCount > 0) userVote = v.rows[0].vote_type;
    }

    res.json({
      upvotes: tally.rows[0].upvotes,
      downvotes: tally.rows[0].downvotes,
      user_vote: userVote,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch votes" });
  }
});

app.post("/api/beatmaps/:id/vote", writeLimiter, async (req, res) => {
  const beatmapId = valid.positiveInt(req.params.id);
  const { user_id, vote_type } = req.body || {};

  if (beatmapId === null) return res.status(400).json({ error: "Bad beatmap id" });
  if (!["upvote", "downvote"].includes(vote_type)) return res.status(400).json({ error: "Invalid vote" });
  if (!user_id) return res.status(401).json({ error: "User ID required" });

  try {
    // self-heal user (only for ids this app could have issued — see submit)
    const userCheck = await db.query("SELECT id FROM users WHERE id=$1", [user_id]);
    if (userCheck.rowCount === 0) {
      if (!valid.isUuid(user_id)) {
        return res.status(400).json({ error: "Unknown user — please register again" });
      }
      await db.query("INSERT INTO users (id, display_name) VALUES ($1,$2)", [user_id, "Voter"]);
    }

    // Same up/down toggle behaviour, but as one statement: a second identical
    // vote clears the row, a different one flips it. Two concurrent clicks can
    // no longer race between the SELECT and the INSERT and hit the unique key.
    const flipped = await db.query(
      `INSERT INTO votes (beatmap_id, user_id, vote_type)
       VALUES ($1, $2, $3)
       ON CONFLICT (beatmap_id, user_id)
       DO UPDATE SET vote_type = EXCLUDED.vote_type
       WHERE votes.vote_type <> EXCLUDED.vote_type
       RETURNING id`,
      [beatmapId, user_id, vote_type]
    );

    // Nothing inserted or updated means the same vote was already there —
    // treat the click as "take it back".
    if (flipped.rowCount === 0) {
      await db.query("DELETE FROM votes WHERE beatmap_id=$1 AND user_id=$2", [beatmapId, user_id]);
    }

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to vote" });
  }
});


app.get("/api/beatmaps/:id/comments", apiLimiter, async (req, res) => {
  const beatmapId = valid.positiveInt(req.params.id);
  if (beatmapId === null) return res.status(400).json({ error: "Bad beatmap id" });

  try {
    const result = await db.query(
      "SELECT * FROM comments WHERE beatmap_id=$1 ORDER BY created_at DESC LIMIT 200",
      [beatmapId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/api/beatmaps/:id/comments", writeLimiter, async (req, res) => {
  const beatmapId = valid.positiveInt(req.params.id);
  const { user_id } = req.body || {};

  if (beatmapId === null) return res.status(400).json({ error: "Bad beatmap id" });

  const comment_text = valid.text(req.body?.comment_text, valid.LIMITS.comment);
  const display_name = valid.text(req.body?.display_name, valid.LIMITS.displayName);

  if (!comment_text) return res.status(400).json({ error: "Empty comment" });
  if (await profanity.isProfane(comment_text)) {
    return res.status(400).json({ error: "Please reword that comment" });
  }

  try {
    const beatmap = await db.query("SELECT 1 FROM beatmaps WHERE id=$1", [beatmapId]);
    if (beatmap.rowCount === 0) return res.status(404).json({ error: "Map not found" });

    if (user_id) {
      const userCheck = await db.query("SELECT id FROM users WHERE id=$1", [user_id]);
      if (userCheck.rowCount === 0) {
        if (!valid.isUuid(user_id)) {
          return res.status(400).json({ error: "Unknown user — please register again" });
        }
        await db.query("INSERT INTO users (id, display_name) VALUES ($1,$2)", [
          user_id,
          display_name || "Commenter",
        ]);
      }
    }

    await db.query(
      "INSERT INTO comments (beatmap_id, user_id, display_name, comment_text) VALUES ($1,$2,$3,$4)",
      [beatmapId, user_id || null, display_name || "Unknown", comment_text]
    );

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to post comment" });
  }
});

// OSU API PROXY
const client_id = process.env.OSU_CLIENT_ID;
const client_secret = process.env.OSU_CLIENT_SECRET;
let access_token = null;
let token_expiry = 0;
let token_request = null;

function formatSeconds(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// Client-credentials token for reading beatmap metadata, cached until it
// expires. The in-flight promise is shared so a burst of submissions asks
// osu! for one token instead of one each, and a failed request clears itself
// so the next call retries rather than reusing a rejected promise.
async function getAccessToken() {
  if (access_token && Date.now() < token_expiry) return access_token;
  if (!client_id || !client_secret) return null;

  if (!token_request) {
    token_request = axios
      .post("https://osu.ppy.sh/oauth/token", {
        client_id,
        client_secret,
        grant_type: "client_credentials",
        scope: "public",
      })
      .then((response) => {
        access_token = response.data.access_token;
        token_expiry = Date.now() + response.data.expires_in * 1000 - 10000;
        return access_token;
      })
      .finally(() => {
        token_request = null;
      });
  }

  return token_request;
}

app.get("/api/beatmap/:id", apiLimiter, async (req, res) => {
  // Numbers only. `../../users/2` here would be normalised by the HTTP layer
  // into a different osu! endpoint, making this route a general-purpose osu!
  // API proxy signed with our own token.
  const beatmapId = valid.osuBeatmapId(req.params.id);
  if (beatmapId === null) return res.status(400).json({ error: "Beatmap id must be a number" });

  try {
    const token = await getAccessToken();
    if (!token) return res.status(500).json({ error: "API not configured" });

    const response = await axios.get(`https://osu.ppy.sh/api/v2/beatmaps/${beatmapId}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      timeout: 10000,
    });

    const bm = response.data;
    const set = bm.beatmapset || {};

    // Every field is optional as far as this handler is concerned: a beatmap
    // without a difficulty_rating used to crash on .toFixed() and answer 500.
    res.json({
      title: `${set.artist ?? "Unknown"} - ${set.title ?? "Unknown"} [${bm.version ?? "?"}]`,
      // The same three pieces again, unjoined, because the ballot card puts
      // them on separate lines. Sent alongside `title` rather than instead of
      // it: `title` is the field people search, edit and see in Discord.
      artist: set.artist ?? null,
      mapper: set.creator ?? null,
      difficulty_name: bm.version ?? null,
      stars: typeof bm.difficulty_rating === "number" ? bm.difficulty_rating.toFixed(2) : "N/A",
      cs: bm.cs ?? "N/A",
      ar: bm.ar ?? "N/A",
      od: bm.accuracy ?? "N/A",
      // osu! calls HP drain `drain` here and "HP Drain" everywhere a player
      // can see it. The card uses the player's name for it.
      hp: bm.drain ?? "N/A",
      bpm: bm.bpm ?? "N/A",
      length: formatSeconds(bm.total_length || 0),
      url: set.id ? `https://osu.ppy.sh/beatmapsets/${set.id}#osu/${bm.id}` : null,
      preview_url: set.preview_url || null,
      // card@2x is 800x280 against card's 400x140. The ballot card shows the
      // art at roughly 200px wide on a retina display, where the 1x asset is
      // visibly soft. Falls back when a set predates the 2x covers.
      cover_url: set.covers?.["card@2x"] || set.covers?.card || null,
    });
  } catch (err) {
    console.error("Beatmap fetch error:", err.message);
    const status = err.response?.status;
    if (status === 404) return res.status(404).json({ error: "That beatmap doesn't exist" });
    res.status(status && status < 500 ? status : 502).json({ error: "Failed to fetch info" });
  }
});

// DISCORD WEBHOOK
const discord_webhook = process.env.DISCORD_WEBHOOK;

// Discord rejects the whole webhook with a 400 if an embed field is empty, too
// long, or holds a URL it can't parse — so everything is trimmed to Discord's
// limits and links are only included when they're really http(s).
const EMBED_TITLE_MAX = 256;
const EMBED_FIELD_MAX = 1024;

app.post("/api/send-discord", discordLimiter, async (req, res) => {
  if (!discord_webhook) return res.status(503).json({ error: "No webhook" });

  try {
    const entry = req.body || {};
    const isBounty = entry.type !== "suggestion";
    const field = (name, raw, fallback, inline = true) => ({
      name,
      value: valid.text(raw, EMBED_FIELD_MAX) || fallback,
      inline,
    });

    const title = valid.text(entry.title, valid.LIMITS.title) || "Untitled";
    const link = valid.httpUrl(entry.url, valid.LIMITS.url);
    const cover = valid.httpUrl(entry.cover_url);

    const embed = {
      title: `${isBounty ? "💰 New Bounty" : "📝 New Suggestion"}: ${title}`.slice(0, EMBED_TITLE_MAX),
      color: isBounty ? 0xf1c40f : 0x8e44ad,
      fields: [
        field("👤 Submitted by", entry.submitted_by_name, "Unknown"),
        field("🎯 Challenge", entry.skill, "N/A"),
        field("🧩 Mods", entry.mod, "NM"),
        field("⭐ Stars", entry.stars, "N/A"),
        field("🔗 Link", link, "N/A", false),
      ],
    };
    // Omitted rather than sent empty — `url: ""` is what Discord 400s on.
    if (link) embed.url = link;
    if (cover) embed.thumbnail = { url: cover };

    await axios.post(discord_webhook, { embeds: [embed] }, { timeout: 10000 });
    res.json({ success: true });
  } catch (err) {
    console.error("Discord webhook failed:", err);
    res.status(500).json({ error: "Failed to send to Discord" });
  }
});

// =====================================================================
// osu! LOGIN — Authorization Code flow
//
// This is a *second* use of your osu! OAuth app. getAccessToken() above
// uses client_credentials to read beatmap metadata as the app itself;
// the routes below log in an actual person so we can count one vote each.
// Same OSU_CLIENT_ID / OSU_CLIENT_SECRET, different grant type.
// =====================================================================
const OSU_AUTHORIZE_URL = "https://osu.ppy.sh/oauth/authorize";
const OSU_TOKEN_URL = "https://osu.ppy.sh/oauth/token";
const OSU_ME_URL = "https://osu.ppy.sh/api/v2/me";

app.get("/api/auth/osu/login", apiLimiter, (req, res) => {
  if (!auth.isAuthConfigured()) {
    return res
      .status(503)
      .json({ error: "osu! login is not configured (need OSU_CLIENT_ID, OSU_CLIENT_SECRET, OSU_REDIRECT_URI, SESSION_SECRET)" });
  }

  const state = crypto.randomBytes(16).toString("hex");
  auth.setStateCookie(res, state);
  // ?next=/ from the bounty form, ?next=/vote (or nothing) from the ballot.
  // Vetted against a list of real pages inside setReturnCookie, so this can't
  // be turned into a redirector to somewhere else.
  auth.setReturnCookie(res, req.query.next);

  const params = new URLSearchParams({
    client_id: process.env.OSU_CLIENT_ID,
    redirect_uri: process.env.OSU_REDIRECT_URI,
    response_type: "code",
    scope: "identify",
    state,
  });

  res.redirect(`${OSU_AUTHORIZE_URL}?${params.toString()}`);
});

app.get("/api/auth/osu/callback", apiLimiter, async (req, res) => {
  // The page sign-in started from, taken from our own cookie rather than from
  // anything osu! echoed back. Read before the first `fail()` so both outcomes
  // land on the same page, and so the cookie is cleared either way.
  const backTo = auth.takeReturnPath(req, res);

  // Errors come back to that page as ?login_error=... so the user sees a
  // readable message instead of raw JSON.
  const fail = (reason) => res.redirect(returnTo.withLoginError(backTo, reason));

  if (!auth.isAuthConfigured()) return fail("not_configured");

  const { code, state } = req.query;
  if (req.query.error) return fail(String(req.query.error));

  const expectedState = auth.readStateCookie(req);
  auth.clearStateCookie(res);
  if (!code || !state || !expectedState || String(state) !== expectedState) return fail("bad_state");

  try {
    const tokenResponse = await axios.post(
      OSU_TOKEN_URL,
      {
        client_id: process.env.OSU_CLIENT_ID,
        client_secret: process.env.OSU_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: process.env.OSU_REDIRECT_URI,
      },
      { headers: { Accept: "application/json" } }
    );

    const me = await axios.get(OSU_ME_URL, {
      headers: { Authorization: `Bearer ${tokenResponse.data.access_token}`, Accept: "application/json" },
    });

    const user = await auth.upsertOsuUser(me.data);

    auth.setSessionCookie(res, {
      user_id: user.id,
      osu_id: String(user.osu_id),
      username: user.username,
      avatar_url: user.avatar_url,
      // Taken from the row we just wrote, not straight off the profile, so the
      // cookie agrees with the database even in the COALESCE case where osu!
      // sent nothing and the stored country was kept.
      country_code: user.country_code,
    });

    console.log(
      `🔑 osu! login: ${user.username} (${user.osu_id}) [${user.country_code || "no country"}]`
    );
    res.redirect(backTo);
  } catch (err) {
    console.error("osu! login failed:", err.response?.data || err.message);
    fail("exchange_failed");
  }
});

app.get("/api/auth/me", apiLimiter, async (req, res) => {
  const session = auth.readSession(req);

  if (!session) {
    return res.json({
      authenticated: false,
      login_configured: auth.isAuthConfigured(),
      // Sent even when signed out so the ballot can say who voting is for
      // before anyone commits to a login. null when there's no restriction.
      vote_country_label: auth.voteCountryLabel(),
    });
  }

  const can_vote = auth.canVote(session);

  res.json({
    authenticated: true,
    login_configured: true,
    user_id: session.user_id,
    osu_id: session.osu_id,
    username: session.username,
    avatar_url: session.avatar_url,
    is_admin: await auth.isAdmin(session),
    country_code: session.country_code,
    can_vote,
    // Only when it's actually being refused, so the client can show the reason
    // without having to work out which of the two cases applies.
    vote_blocked_reason: can_vote ? null : auth.voteRefusalReason(session),
    vote_country_label: auth.voteCountryLabel(),
  });
});

app.post("/api/auth/logout", apiLimiter, (req, res) => {
  auth.clearSessionCookie(res);
  res.json({ success: true });
});

// =====================================================================
// MONTHLY CHALLENGE VOTING — one vote per osu! account
//
// The guarantee lives in the database: challenge_votes has
// PRIMARY KEY (challenge_id, osu_id), so a crafted request cannot
// double-vote. Voting again just moves your existing vote.
// =====================================================================

const CHALLENGE_FIELDS = `id, month, title, bounty, status, winner_beatmap_id, closes_at, created_at`;

async function getChallenge(id) {
  const r = await db.query(`SELECT ${CHALLENGE_FIELDS} FROM challenges WHERE id = $1`, [id]);
  return r.rowCount ? r.rows[0] : null;
}

// The round players should be looking at: the open one, else the most
// recently closed one so the winner banner stays up between rounds.
async function getVisibleChallenge() {
  const open = await db.query(
    `SELECT ${CHALLENGE_FIELDS} FROM challenges WHERE status = 'open' ORDER BY created_at DESC LIMIT 1`
  );
  if (open.rowCount) return open.rows[0];

  const closed = await db.query(
    `SELECT ${CHALLENGE_FIELDS} FROM challenges WHERE status = 'closed' ORDER BY created_at DESC LIMIT 1`
  );
  return closed.rowCount ? closed.rows[0] : null;
}

async function getCandidates(challengeId) {
  const r = await db.query(
    `
    SELECT b.id            AS beatmap_id,
           b.title, b.url, b.stars, b.cs, b.ar, b.od, b.hp, b.bpm, b.length,
           b.artist, b.mapper, b.difficulty_name,
           b.slot, b.mod, b.skill, b.notes, b.cover_url, b.preview_url, b.type,
           u.display_name  AS submitted_by_name,
           COALESCE(t.votes, 0)::int AS votes
    FROM challenge_candidates cc
    JOIN beatmaps b ON b.id = cc.beatmap_id
    LEFT JOIN users u ON u.id = b.submitted_by
    LEFT JOIN (
      SELECT beatmap_id, COUNT(*)::int AS votes
      FROM challenge_votes
      WHERE challenge_id = $1
      GROUP BY beatmap_id
    ) t ON t.beatmap_id = b.id
    WHERE cc.challenge_id = $1
    ORDER BY votes DESC, b.title ASC
  `,
    [challengeId]
  );

  // Attached here rather than joined above so every caller — the ballot, a
  // vote, the results — reports the same number without repeating itself.
  const counts = await getCommentCounts(challengeId);
  return r.rows.map((row) => ({ ...row, comment_count: counts.get(row.beatmap_id) || 0 }));
}

let warnedAboutCommentsTable = false;

// The "N comments" figure on each card. Deliberately its own query instead of
// another LEFT JOIN in getCandidates: challenge_comments is newer than the rest
// of the schema, and a deploy that lands before `npm run migrate` is run would
// otherwise take the whole voting page down with it. Same instinct as
// lib/profanity.js — fail open, loudly, rather than fail the request.
async function getCommentCounts(challengeId) {
  try {
    const r = await db.query(
      `SELECT beatmap_id, COUNT(*)::int AS n
       FROM challenge_comments
       WHERE challenge_id = $1 AND deleted_at IS NULL
       GROUP BY beatmap_id`,
      [challengeId]
    );
    return new Map(r.rows.map((row) => [row.beatmap_id, row.n]));
  } catch (err) {
    // 42P01 = undefined_table.
    if (err.code !== "42P01") throw err;
    if (!warnedAboutCommentsTable) {
      warnedAboutCommentsTable = true;
      console.error(
        "challenge_comments is missing — run `npm run migrate`. Serving the ballot with zero comment counts."
      );
    }
    return new Map();
  }
}

async function countVoters(challengeId) {
  const r = await db.query("SELECT COUNT(*)::int AS n FROM challenge_votes WHERE challenge_id = $1", [
    challengeId,
  ]);
  return r.rows[0].n;
}

async function getMyVote(challengeId, osuId) {
  if (!osuId) return null;
  const r = await db.query(
    "SELECT beatmap_id FROM challenge_votes WHERE challenge_id = $1 AND osu_id = $2",
    [challengeId, osuId]
  );
  return r.rowCount ? r.rows[0].beatmap_id : null;
}

// Has the deadline passed? closes_at is optional.
function isPastDeadline(challenge) {
  return Boolean(challenge.closes_at && new Date(challenge.closes_at).getTime() <= Date.now());
}

async function buildChallengePayload(challenge, session) {
  const [candidates, totalVoters, myVote] = await Promise.all([
    getCandidates(challenge.id),
    countVoters(challenge.id),
    getMyVote(challenge.id, session?.osu_id),
  ]);

  let winner = null;
  if (challenge.status === "closed" && challenge.winner_beatmap_id) {
    winner = candidates.find((c) => c.beatmap_id === challenge.winner_beatmap_id) || null;
  }

  return {
    id: challenge.id,
    month: challenge.month,
    title: challenge.title,
    bounty: challenge.bounty,
    status: challenge.status,
    closes_at: challenge.closes_at,
    voting_closed: challenge.status !== "open" || isPastDeadline(challenge),
    candidates,
    total_voters: totalVoters,
    my_vote: myVote,
    winner,
  };
}

// Public: whatever round the voting page should show. 204 = no round yet.
app.get("/api/challenges/current", apiLimiter, async (req, res) => {
  try {
    const challenge = await getVisibleChallenge();
    if (!challenge) return res.status(204).end();
    res.json(await buildChallengePayload(challenge, auth.readSession(req)));
  } catch (err) {
    console.error("Load current challenge failed:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Cast or move your single vote. requireVoter, not requireAuth: the ballot is
// for the Algerian community, so eligibility is checked from the country on the
// osu! profile. See auth.js — reading and commenting stay open to everyone.
app.post("/api/challenges/:id/vote", apiLimiter, auth.requireVoter, async (req, res) => {
  const challengeId = Number(req.params.id);
  const beatmapId = Number(req.body?.beatmap_id);

  if (!Number.isInteger(challengeId) || !Number.isInteger(beatmapId)) {
    return res.status(400).json({ error: "challenge id and beatmap_id must be numbers" });
  }

  try {
    const challenge = await getChallenge(challengeId);
    if (!challenge) return res.status(404).json({ error: "Round not found" });
    if (challenge.status !== "open") return res.status(403).json({ error: "This round is not open for voting" });
    if (isPastDeadline(challenge)) return res.status(403).json({ error: "Voting has closed for this round" });

    const candidate = await db.query(
      "SELECT 1 FROM challenge_candidates WHERE challenge_id = $1 AND beatmap_id = $2",
      [challengeId, beatmapId]
    );
    if (candidate.rowCount === 0) {
      return res.status(400).json({ error: "That beatmap is not on this round's ballot" });
    }

    // One row per (challenge, osu_id) — voting again moves the vote.
    await db.query(
      `
      INSERT INTO challenge_votes (challenge_id, osu_id, beatmap_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (challenge_id, osu_id)
      DO UPDATE SET beatmap_id = EXCLUDED.beatmap_id, updated_at = NOW()
    `,
      [challengeId, req.session.osu_id, beatmapId]
    );

    const [candidates, totalVoters] = await Promise.all([
      getCandidates(challengeId),
      countVoters(challengeId),
    ]);

    res.json({ success: true, my_vote: beatmapId, candidates, total_voters: totalVoters });
  } catch (err) {
    console.error("Vote failed:", err);
    res.status(500).json({ error: "Failed to record vote" });
  }
});

app.get("/api/challenges/:id/results", apiLimiter, async (req, res) => {
  const challengeId = Number(req.params.id);
  if (!Number.isInteger(challengeId)) return res.status(400).json({ error: "Bad round id" });

  try {
    const challenge = await getChallenge(challengeId);
    if (!challenge) return res.status(404).json({ error: "Round not found" });
    if (challenge.status === "draft") return res.status(403).json({ error: "This round isn't published yet" });

    const [candidates, totalVoters] = await Promise.all([
      getCandidates(challengeId),
      countVoters(challengeId),
    ]);
    res.json({
      challenge_id: challengeId,
      status: challenge.status,
      total_voters: totalVoters,
      leader: candidates.length ? candidates[0] : null, // getCandidates orders by votes DESC
      winner_beatmap_id: challenge.winner_beatmap_id,
      candidates,
    });
  } catch (err) {
    console.error("Results failed:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// =====================================================================
// DISCUSSION — one thread per map on the ballot, one level of replies
//
// Deliberately not the /community `comments` table: that one trusts a
// display_name out of the request body, so anyone can post as anyone.
// These are signed by the osu! account in the session cookie, which is
// what makes "edit yours, delete yours, admins delete anyone's" mean
// something. See section 6 of schema.sql.
// =====================================================================

// Enough for a busy thread, small enough that the response stays sane. The
// ORDER BY below is ASC on purpose: a reply is always newer than its parent,
// so cutting at the limit can never return a reply whose parent is missing.
const COMMENT_PAGE_LIMIT = 500;

// username / avatar_url are joined at read time rather than copied onto the
// comment, so a rename or a new avatar follows the person through old threads.
const COMMENT_SELECT = `
  SELECT c.id,
         c.parent_id,
         c.osu_id::text AS osu_id,
         c.body,
         c.created_at,
         c.edited_at,
         c.deleted_at,
         u.username,
         u.avatar_url
  FROM challenge_comments c
  LEFT JOIN users u ON u.osu_id = c.osu_id
`;

// Comments follow the ballot: open round = you can talk, closed round = the
// thread is an archive. Deleting is the exception — see the DELETE route.
function isThreadLocked(challenge) {
  return challenge.status !== "open" || isPastDeadline(challenge);
}

// The wire shape of one comment. A tombstone gives up its text, its author and
// its avatar here — the row keeps them (schema.sql explains why), the API just
// never hands them out.
function shapeComment(row, viewer) {
  const deleted = Boolean(row.deleted_at);
  return {
    id: row.id,
    parent_id: row.parent_id,
    osu_id: deleted ? null : row.osu_id,
    author: deleted ? null : row.username || `osu-${row.osu_id}`,
    avatar_url: deleted ? null : row.avatar_url,
    body: deleted ? null : row.body,
    created_at: row.created_at,
    edited_at: deleted ? null : row.edited_at,
    deleted,
    // Worked out here rather than in the browser: pg hands BIGINT back as a
    // string and the session holds another, and `1 == "1"` is the kind of
    // comparison that eventually shows someone an Edit button on a stranger's
    // comment. The routes below re-check it anyway.
    is_mine: !deleted && Boolean(viewer) && String(row.osu_id) === String(viewer.osu_id),
  };
}

// Flat rows (oldest first) -> top-level comments each carrying their replies.
// A deleted comment only survives as a placeholder when something still hangs
// off it; a deleted reply, having nothing under it, simply goes.
function buildThread(rows, viewer) {
  const repliesByParent = new Map();
  const tops = [];

  for (const row of rows) {
    if (row.parent_id === null) {
      tops.push(row);
    } else {
      if (!repliesByParent.has(row.parent_id)) repliesByParent.set(row.parent_id, []);
      repliesByParent.get(row.parent_id).push(row);
    }
  }

  const thread = [];
  for (const row of tops) {
    const replies = (repliesByParent.get(row.id) || [])
      .filter((reply) => !reply.deleted_at)
      .map((reply) => shapeComment(reply, viewer));

    if (row.deleted_at && replies.length === 0) continue;
    thread.push({ ...shapeComment(row, viewer), replies });
  }

  // Newest conversation at the top, but replies inside a group stay oldest
  // first so a back-and-forth reads in the order it happened.
  return thread.reverse();
}

// Shared front door for the routes below: the round has to exist and be
// published, and the map has to actually be on its ballot. Returns
// { status, error } on refusal, { challenge } on success.
async function loadThreadTarget(challengeId, beatmapId) {
  if (challengeId === null || beatmapId === null) {
    return { status: 400, error: "Bad round or beatmap id" };
  }

  const challenge = await getChallenge(challengeId);
  if (!challenge) return { status: 404, error: "Round not found" };
  // A draft is invisible to players, and so is any discussion of it.
  if (challenge.status === "draft") return { status: 403, error: "This round isn't published yet" };

  const onBallot = await db.query(
    "SELECT 1 FROM challenge_candidates WHERE challenge_id = $1 AND beatmap_id = $2",
    [challengeId, beatmapId]
  );
  if (onBallot.rowCount === 0) {
    return { status: 404, error: "That beatmap is not on this round's ballot" };
  }

  return { challenge };
}

// Read a map's thread. Open to guests — you don't need an account to follow
// the argument, only to join it.
app.get("/api/challenges/:id/candidates/:beatmapId/comments", apiLimiter, async (req, res) => {
  const challengeId = valid.positiveInt(req.params.id);
  const beatmapId = valid.positiveInt(req.params.beatmapId);

  try {
    const target = await loadThreadTarget(challengeId, beatmapId);
    if (target.error) return res.status(target.status).json({ error: target.error });

    const viewer = auth.readSession(req);
    const rows = await db.query(
      `${COMMENT_SELECT}
       WHERE c.challenge_id = $1 AND c.beatmap_id = $2
       ORDER BY c.created_at ASC, c.id ASC
       LIMIT $3`,
      [challengeId, beatmapId, COMMENT_PAGE_LIMIT]
    );

    res.json({
      challenge_id: challengeId,
      beatmap_id: beatmapId,
      locked: isThreadLocked(target.challenge),
      // The count the card shows, kept consistent with getCandidates: what
      // people actually said, tombstones excluded.
      total: rows.rows.reduce((n, row) => (row.deleted_at ? n : n + 1), 0),
      comments: buildThread(rows.rows, viewer),
    });
  } catch (err) {
    console.error("Load comments failed:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Post a comment, or a reply to one.
app.post(
  "/api/challenges/:id/candidates/:beatmapId/comments",
  writeLimiter,
  auth.requireAuth,
  async (req, res) => {
    const challengeId = valid.positiveInt(req.params.id);
    const beatmapId = valid.positiveInt(req.params.beatmapId);
    const body = valid.commentBody(req.body?.body);

    // "No parent" and "a parent id we can't make sense of" are different
    // things: the first is a top-level comment, the second is a bad request.
    const rawParent = req.body?.parent_id;
    const wantsParent = rawParent !== null && rawParent !== undefined && rawParent !== "";
    const parentId = wantsParent ? valid.positiveInt(rawParent) : null;

    if (!body) return res.status(400).json({ error: "Write something first" });
    if (wantsParent && parentId === null) return res.status(400).json({ error: "Bad parent comment id" });
    if (await profanity.isProfane(body)) {
      return res.status(400).json({ error: "Please reword that comment" });
    }

    try {
      const target = await loadThreadTarget(challengeId, beatmapId);
      if (target.error) return res.status(target.status).json({ error: target.error });
      if (isThreadLocked(target.challenge)) {
        return res.status(403).json({ error: "This round is closed — the thread is read-only now" });
      }

      let resolvedParent = null;
      if (parentId !== null) {
        // Scoped to this thread, so a parent id can't graft a reply onto a
        // different map's conversation (or a different round's).
        const parent = await db.query(
          `SELECT id, parent_id FROM challenge_comments
           WHERE id = $1 AND challenge_id = $2 AND beatmap_id = $3`,
          [parentId, challengeId, beatmapId]
        );
        if (parent.rowCount === 0) return res.status(404).json({ error: "That comment is no longer here" });

        // Replying to a reply joins the group it belongs to instead of nesting
        // deeper. That's what keeps threads one level deep, and it's nicer
        // than refusing a button the reader had every reason to press.
        resolvedParent = parent.rows[0].parent_id ?? parent.rows[0].id;
      }

      // A double-tapped Post button, or a retry after a response got lost,
      // shouldn't say the same thing twice. Same author, same thread, same
      // text, within a minute: hand back the comment that's already there.
      // IS NOT DISTINCT FROM because parent_id is NULL for top-level ones.
      const duplicate = await db.query(
        `SELECT id FROM challenge_comments
         WHERE challenge_id = $1 AND beatmap_id = $2 AND osu_id = $3
           AND body = $4 AND parent_id IS NOT DISTINCT FROM $5
           AND deleted_at IS NULL
           AND created_at > NOW() - INTERVAL '1 minute'
         LIMIT 1`,
        [challengeId, beatmapId, req.session.osu_id, body, resolvedParent]
      );

      let commentId;
      if (duplicate.rowCount > 0) {
        commentId = duplicate.rows[0].id;
      } else {
        const inserted = await db.query(
          `INSERT INTO challenge_comments (challenge_id, beatmap_id, parent_id, osu_id, body)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [challengeId, beatmapId, resolvedParent, req.session.osu_id, body]
        );
        commentId = inserted.rows[0].id;
      }

      const created = await db.query(`${COMMENT_SELECT} WHERE c.id = $1`, [commentId]);
      res.status(201).json({ success: true, comment: shapeComment(created.rows[0], req.session) });
    } catch (err) {
      console.error("Post comment failed:", err);
      res.status(500).json({ error: "Failed to post comment" });
    }
  }
);

// Edit your own comment. Admins are deliberately not an exception here:
// rewriting someone else's comment puts words in their mouth. They can delete.
app.patch("/api/challenges/:id/comments/:commentId", writeLimiter, auth.requireAuth, async (req, res) => {
  const challengeId = valid.positiveInt(req.params.id);
  const commentId = valid.positiveInt(req.params.commentId);
  const body = valid.commentBody(req.body?.body);

  if (challengeId === null || commentId === null) return res.status(400).json({ error: "Bad id" });
  if (!body) return res.status(400).json({ error: "A comment can't be empty — delete it instead" });
  if (await profanity.isProfane(body)) {
    return res.status(400).json({ error: "Please reword that comment" });
  }

  try {
    const existing = await db.query(
      `SELECT id, osu_id::text AS osu_id, deleted_at
       FROM challenge_comments WHERE id = $1 AND challenge_id = $2`,
      [commentId, challengeId]
    );
    if (existing.rowCount === 0) return res.status(404).json({ error: "Comment not found" });

    const row = existing.rows[0];
    if (row.deleted_at) return res.status(410).json({ error: "That comment was deleted" });
    if (String(row.osu_id) !== String(req.session.osu_id)) {
      return res.status(403).json({ error: "You can only edit your own comments" });
    }

    const challenge = await getChallenge(challengeId);
    if (!challenge) return res.status(404).json({ error: "Round not found" });
    // Editing after the round ends would let someone rewrite history under a
    // result that's already been argued over.
    if (isThreadLocked(challenge)) {
      return res.status(403).json({ error: "This round is closed — comments can't be edited any more" });
    }

    await db.query("UPDATE challenge_comments SET body = $1, edited_at = NOW() WHERE id = $2", [
      body,
      commentId,
    ]);

    const updated = await db.query(`${COMMENT_SELECT} WHERE c.id = $1`, [commentId]);
    res.json({ success: true, comment: shapeComment(updated.rows[0], req.session) });
  } catch (err) {
    console.error("Edit comment failed:", err);
    res.status(500).json({ error: "Failed to save that edit" });
  }
});

// Delete your own, or anyone's if you're an admin. Allowed even on a closed
// round: taking your own words back, and acting on a report, both have to keep
// working after voting ends.
app.delete("/api/challenges/:id/comments/:commentId", writeLimiter, auth.requireAuth, async (req, res) => {
  const challengeId = valid.positiveInt(req.params.id);
  const commentId = valid.positiveInt(req.params.commentId);

  if (challengeId === null || commentId === null) return res.status(400).json({ error: "Bad id" });

  try {
    const existing = await db.query(
      `SELECT id, osu_id::text AS osu_id, deleted_at
       FROM challenge_comments WHERE id = $1 AND challenge_id = $2`,
      [commentId, challengeId]
    );
    if (existing.rowCount === 0) return res.status(404).json({ error: "Comment not found" });

    const row = existing.rows[0];
    const mine = String(row.osu_id) === String(req.session.osu_id);
    if (!mine && !(await auth.isAdmin(req.session))) {
      return res.status(403).json({ error: "You can only delete your own comments" });
    }

    // Already a tombstone. Reporting that as an error would make a double
    // click look like a failure.
    if (row.deleted_at) return res.json({ success: true, outcome: "tombstoned" });

    // A comment that's been answered leaves a placeholder, so deleting it
    // doesn't take the replies down with it. One that hasn't goes for real —
    // and that clears out any tombstoned replies beneath it, by cascade.
    const liveReplies = await db.query(
      "SELECT 1 FROM challenge_comments WHERE parent_id = $1 AND deleted_at IS NULL LIMIT 1",
      [commentId]
    );

    if (liveReplies.rowCount > 0) {
      await db.query("UPDATE challenge_comments SET deleted_at = NOW() WHERE id = $1", [commentId]);
      return res.json({ success: true, outcome: "tombstoned" });
    }

    await db.query("DELETE FROM challenge_comments WHERE id = $1", [commentId]);
    res.json({ success: true, outcome: "removed" });
  } catch (err) {
    console.error("Delete comment failed:", err);
    res.status(500).json({ error: "Failed to delete that comment" });
  }
});

// =====================================================================
// ADMIN — run the rounds. Gated by ADMIN_OSU_IDS (or users.is_admin).
// =====================================================================

app.get("/api/admin/challenges", apiLimiter, auth.requireAdmin, async (req, res) => {
  try {
    const r = await db.query(`
      SELECT c.id, c.month, c.title, c.bounty, c.status, c.winner_beatmap_id, c.closes_at, c.created_at,
             (SELECT COUNT(*)::int FROM challenge_candidates cc WHERE cc.challenge_id = c.id) AS candidate_count,
             (SELECT COUNT(*)::int FROM challenge_votes cv WHERE cv.challenge_id = c.id) AS total_voters
      FROM challenges c
      ORDER BY c.created_at DESC
    `);
    res.json(r.rows);
  } catch (err) {
    console.error("Admin list failed:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// One round with its ballot — works for drafts too, which the public
// endpoints deliberately hide.
app.get("/api/admin/challenges/:id", apiLimiter, auth.requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Bad round id" });

  try {
    const challenge = await getChallenge(id);
    if (!challenge) return res.status(404).json({ error: "Round not found" });
    res.json(await buildChallengePayload(challenge, req.session));
  } catch (err) {
    console.error("Admin load round failed:", err);
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/api/admin/challenges", apiLimiter, auth.requireAdmin, async (req, res) => {
  const { month, title, bounty, closes_at } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: "Title is required" });

  try {
    const r = await db.query(
      `INSERT INTO challenges (month, title, bounty, closes_at, status)
       VALUES ($1, $2, $3, $4, 'draft')
       RETURNING ${CHALLENGE_FIELDS}`,
      [month || null, String(title).trim(), bounty || null, closes_at || null]
    );
    res.json(r.rows[0]);
  } catch (err) {
    console.error("Create round failed:", err);
    res.status(500).json({ error: "Failed to create round" });
  }
});

app.patch("/api/admin/challenges/:id", apiLimiter, auth.requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Bad round id" });

  const body = req.body || {};
  const status = body.status;

  // Closing goes through POST /close only — that route is where the winner is
  // worked out, so allowing status:"closed" here would publish a round with no
  // winner at all.
  if (status !== undefined && !["draft", "open"].includes(status)) {
    return res.status(400).json({ error: 'status must be "draft" or "open" — use /close to finish a round' });
  }
  if ("title" in body && !String(body.title ?? "").trim()) {
    return res.status(400).json({ error: "Title cannot be empty" });
  }
  if (body.closes_at && Number.isNaN(new Date(body.closes_at).getTime())) {
    return res.status(400).json({ error: "closes_at must be a date" });
  }

  try {
    const challenge = await getChallenge(id);
    if (!challenge) return res.status(404).json({ error: "Round not found" });

    // Only one round may be open at a time. Refusing (rather than silently
    // closing the other one) keeps you in control of when a round ends.
    if (status === "open") {
      const other = await db.query(
        "SELECT id, title FROM challenges WHERE status = 'open' AND id <> $1 LIMIT 1",
        [id]
      );
      if (other.rowCount) {
        return res.status(409).json({
          error: `"${other.rows[0].title}" (round ${other.rows[0].id}) is already open — close it first.`,
        });
      }
      const hasCandidates = await db.query(
        "SELECT 1 FROM challenge_candidates WHERE challenge_id = $1 LIMIT 1",
        [id]
      );
      if (hasCandidates.rowCount === 0) {
        return res.status(400).json({ error: "Add at least one beatmap to the ballot before opening." });
      }
    }

    // The SET clause is built from the keys actually present in the body, so
    // sending "" or null genuinely clears a field. (COALESCE could only ever
    // keep the old value, which made month/bounty impossible to erase.)
    const sets = [];
    const params = [];
    const set = (column, value, cast) => {
      params.push(value);
      sets.push(`${column} = $${params.length}${cast}`);
    };
    const text = (value) => {
      const trimmed = value == null ? "" : String(value).trim();
      return trimmed || null;
    };

    if ("month" in body) set("month", text(body.month), "::text");
    if ("title" in body) set("title", String(body.title).trim(), "::text");
    if ("bounty" in body) set("bounty", text(body.bounty), "::text");
    if ("closes_at" in body) set("closes_at", body.closes_at || null, "::timestamptz");
    if (status !== undefined) {
      set("status", status, "::text");
      // Reopening a finished round drops the old winner, otherwise the banner
      // would still be pointing at last month's map.
      set("winner_beatmap_id", null, "::int");
    }

    if (sets.length === 0) return res.json(challenge);

    params.push(id);
    const r = await db.query(
      `UPDATE challenges SET ${sets.join(", ")} WHERE id = $${params.length}
       RETURNING ${CHALLENGE_FIELDS}`,
      params
    );

    res.json(r.rows[0]);
  } catch (err) {
    // challenges_single_open (schema.sql) is the database-level version of the
    // "one open round" rule above; it only fires if two admins click Open at
    // the same instant, and deserves the same 409 as the check that caught it.
    if (err.code === "23505") {
      return res.status(409).json({ error: "Another round was opened just now — close it first." });
    }
    console.error("Update round failed:", err);
    res.status(500).json({ error: "Failed to update round" });
  }
});

app.post("/api/admin/challenges/:id/candidates", apiLimiter, auth.requireAdmin, async (req, res) => {
  const challengeId = Number(req.params.id);
  const beatmapId = Number(req.body?.beatmap_id);

  if (!Number.isInteger(challengeId) || !Number.isInteger(beatmapId)) {
    return res.status(400).json({ error: "challenge id and beatmap_id must be numbers" });
  }

  try {
    const challenge = await getChallenge(challengeId);
    if (!challenge) return res.status(404).json({ error: "Round not found" });
    if (challenge.status === "closed") {
      return res.status(409).json({
        error: "This round is closed — reopen it as a draft before editing the ballot.",
      });
    }

    const beatmap = await db.query("SELECT 1 FROM beatmaps WHERE id = $1", [beatmapId]);
    if (beatmap.rowCount === 0) return res.status(404).json({ error: "Beatmap not found" });

    await db.query(
      `INSERT INTO challenge_candidates (challenge_id, beatmap_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [challengeId, beatmapId]
    );

    res.json({ success: true, candidates: await getCandidates(challengeId) });
  } catch (err) {
    console.error("Add candidate failed:", err);
    res.status(500).json({ error: "Failed to add beatmap to the ballot" });
  }
});

app.delete(
  "/api/admin/challenges/:id/candidates/:beatmapId",
  apiLimiter,
  auth.requireAdmin,
  async (req, res) => {
    const challengeId = Number(req.params.id);
    const beatmapId = Number(req.params.beatmapId);

    if (!Number.isInteger(challengeId) || !Number.isInteger(beatmapId)) {
      return res.status(400).json({ error: "challenge id and beatmap id must be numbers" });
    }

    try {
      const challenge = await getChallenge(challengeId);
      if (!challenge) return res.status(404).json({ error: "Round not found" });

      // Editing a finished ballot would erase the historical tally and can
      // orphan winner_beatmap_id, so the winner banner shows "no winner".
      if (challenge.status === "closed") {
        return res.status(409).json({
          error: "This round is closed — reopen it as a draft before editing the ballot.",
        });
      }

      await db.query("DELETE FROM challenge_candidates WHERE challenge_id = $1 AND beatmap_id = $2", [
        challengeId,
        beatmapId,
      ]);
      // Drop votes that pointed at a map no longer on the ballot.
      await db.query("DELETE FROM challenge_votes WHERE challenge_id = $1 AND beatmap_id = $2", [
        challengeId,
        beatmapId,
      ]);
      res.json({ success: true, candidates: await getCandidates(challengeId) });
    } catch (err) {
      console.error("Remove candidate failed:", err);
      res.status(500).json({ error: "Failed to remove beatmap from the ballot" });
    }
  }
);

// Close voting and lock in the winner. Highest tally wins; pass
// winner_beatmap_id to settle a tie (or overrule) yourself.
app.post("/api/admin/challenges/:id/close", apiLimiter, auth.requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Bad round id" });

  // A bad override must be rejected, never silently ignored — Number("abc")
  // is NaN, which is falsy, and would have quietly crowned the top tally
  // instead of the map the admin asked for.
  const raw = req.body?.winner_beatmap_id;
  const override = raw === undefined || raw === null || raw === "" ? null : Number(raw);
  if (override !== null && !Number.isInteger(override)) {
    return res.status(400).json({ error: "winner_beatmap_id must be a number" });
  }

  try {
    const challenge = await getChallenge(id);
    if (!challenge) return res.status(404).json({ error: "Round not found" });
    if (challenge.status === "draft") {
      return res.status(400).json({ error: "Open the round before closing it." });
    }

    const candidates = await getCandidates(id); // already ordered votes DESC
    let winnerId = override;

    if (winnerId !== null) {
      if (!candidates.some((c) => c.beatmap_id === winnerId)) {
        return res.status(400).json({ error: "That beatmap is not on this round's ballot" });
      }
    } else if (candidates.length && candidates[0].votes > 0) {
      winnerId = candidates[0].beatmap_id;
    } else if (challenge.status === "closed") {
      // Re-closing an already-finished round with no override must not erase
      // the winner that's already published.
      winnerId = challenge.winner_beatmap_id;
    }

    const r = await db.query(
      `UPDATE challenges SET status = 'closed', winner_beatmap_id = $1 WHERE id = $2
       RETURNING ${CHALLENGE_FIELDS}`,
      [winnerId, id]
    );

    const tied =
      override === null &&
      candidates.length > 1 &&
      candidates[0].votes > 0 &&
      candidates[0].votes === candidates[1].votes;

    res.json({ success: true, challenge: r.rows[0], tied, candidates });
  } catch (err) {
    console.error("Close round failed:", err);
    res.status(500).json({ error: "Failed to close the round" });
  }
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// The React voting page. Built by `npm run build` into public/vote/.
const VOTE_INDEX = path.join(__dirname, "public", "vote", "index.html");
app.get("/vote", (req, res) => {
  if (!fs.existsSync(VOTE_INDEX)) {
    return res.status(503).type("html").send(
      `<!doctype html><html><head><meta charset="utf-8"><title>Voting page not built</title>
       <style>body{background:#12121c;color:#eee;font:16px/1.6 system-ui;padding:3rem;max-width:40rem;margin:auto}
       code{background:#000;padding:.2rem .45rem;border-radius:6px;color:#ff66aa}</style></head>
       <body><h1>Voting page isn't built yet</h1>
       <p>Run <code>npm run build</code> in the project root, then reload this page.</p>
       <p><a style="color:#64b5f6" href="/">← Back to submissions</a></p></body></html>`
    );
  }
  res.sendFile(VOTE_INDEX);
});

app.get("/community", (req, res) => res.sendFile(path.join(__dirname, "public", "community.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));

app.get("/api/health", (req, res) => res.json({ status: "ok", env: process.env.NODE_ENV || "production" }));
// Rate-limited, and the pg error text stays in the logs — it can name the
// database host and user.
app.get("/api/debug/db", apiLimiter, async (req, res) => {
  try {
    const r = await db.query("SELECT NOW() as now");
    res.json({ ok: true, now: r.rows[0].now });
  } catch (e) {
    console.error("DB check failed:", e.message);
    res.status(500).json({ ok: false, error: "Database unreachable" });
  }
});

// Unknown /api/* paths answered as JSON. Without this they fell through to
// Express's HTML 404 page, so a typo'd endpoint made the fetch wrapper report
// "Unexpected token '<'" instead of a 404.
app.use("/api", (req, res) => res.status(404).json({ error: `No such endpoint: ${req.method} /api${req.path}` }));

// Last-resort error handler. The main thing it catches is a malformed JSON
// body (express.json throws a SyntaxError before any route runs) — that used
// to come back as an HTML stack page.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  const isBadJson = err instanceof SyntaxError && "body" in err;
  const status = isBadJson ? 400 : err.status || err.statusCode || 500;

  if (!isBadJson) console.error("Unhandled request error:", err);

  if (req.path.startsWith("/api")) {
    return res.status(status).json({ error: isBadJson ? "Malformed JSON body" : "Server error" });
  }
  res.status(status).type("text").send(isBadJson ? "Malformed request body" : "Server error");
});

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${port}`);
  profanity.warmUp(); // load the word list now, not on the first comment
});

// Render (and Docker, and Ctrl-C) send SIGTERM/SIGINT. Finish in-flight
// requests and hand the Postgres connections back instead of having them
// torn down mid-query.
let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`↩  ${signal} received — shutting down.`);

    // Don't wait forever on a hung keep-alive connection.
    const force = setTimeout(() => {
      console.warn("⚠  Shutdown timed out — exiting anyway.");
      process.exit(1);
    }, 10000).unref();

    server.close(async () => {
      clearTimeout(force);
      try {
        await db.end();
      } catch (err) {
        console.error("Pool shutdown error:", err.message);
      }
      process.exit(0);
    });
  });
}

// A rejected promise nobody awaited used to be invisible. Log it instead of
// letting Node print a bare warning (or, on newer Node, kill the process).
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});
