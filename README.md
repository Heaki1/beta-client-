# osu!dz

An osu! community site: players submit beatmaps (which get pushed to a Discord webhook),
and vote on which one becomes the next Beatmap of the Month challenge for a bounty.

| Page      | What it is                                                     |
| --------- | -------------------------------------------------------------- |
| `/`       | Submit a bounty — sign in with osu!, autofills stats from the osu! API, posts to Discord |
| `/admin`  | Submit a mappool suggestion (slot, mods, skill, notes)          |
| `/vote`   | **Beatmap of the Month voting** — React app, one vote per osu! account, with a discussion thread per map |
| `/community` | The old up/down vote page, kept as a fallback                |

## Voting, in short

An admin opens a round, shortlists submitted maps onto the ballot, and sets a free-text
bounty (`$50 + Discord role`) and a deadline. Players sign in with their osu! account and
get **exactly one vote**, which they can move to a different map until voting closes.
The one-vote rule is enforced by the database — `challenge_votes` has
`PRIMARY KEY (challenge_id, osu_id)` — so it can't be bypassed by crafting requests.
When the round closes, the map with the most votes is published as the winner.

### Who may vote

Voting is limited to players whose **osu! profile flag is Algeria**. The flag is read from
the osu! profile at sign-in and stored in `users.country_code`, so it can't be set by the
account it describes — only osu! itself ever supplies it. A player who has just changed
their flag has to sign out and back in before it counts.

Everything else stays open: anyone can read the ballot, play the previews, and post in the
discussion threads, signed in from anywhere. The restriction is about deciding the winner,
not about who is allowed to talk.

Set `VOTER_COUNTRIES` to change the list (comma-separated ISO country codes, e.g.
`DZ,TN`). A value that doesn't parse falls back to `DZ` rather than to "everyone", so a
typo can't open the ballot up. To switch the rule off — which is how you test the ballot
from outside Algeria — set it to exactly `any`, `all` or `*`; leaving it empty won't do it.
**Admins are not exempt**: to vote from elsewhere, widen `VOTER_COUNTRIES`, where the
change is visible, rather than relying on an invisible branch in the code.

The rule applies from the moment it's deployed. Votes cast before it existed stay in the
table — to see whether any need removing:

```sql
SELECT v.challenge_id, v.osu_id, u.username, u.country_code
FROM challenge_votes v
LEFT JOIN users u ON u.osu_id = v.osu_id
WHERE u.country_code IS DISTINCT FROM 'DZ'
ORDER BY v.challenge_id, u.username;
```

`country_code IS NULL` there means "hasn't signed in since the column was added" rather
than "not Algerian", so check those against osu! before deleting anything.

Deploying this **signs everyone out once**, on purpose: the session cookie now carries the
country, and a cookie minted before that has no country in it. Rather than treat a missing
value as "not Algerian" and silently block every existing player for up to 30 days,
`auth.js` bumps `SESSION_VERSION`, which makes older cookies stop being accepted. Players
click "Sign in with osu!" again and get a session that knows their flag.

## Discussion

Every map on the ballot has its own thread, one level of replies deep — replying to a
reply joins the same group rather than nesting further, so a thread can't march off the
side of a card. Comments are signed by the osu! account in your session, the same
identity that owns your vote, which is what makes the rest of it work: you can edit and
delete your own, admins can remove anyone's, and nobody can post as someone else.

Deleting a comment that has replies leaves a `[deleted]` placeholder instead of taking
the answers to it along too; one with no replies is deleted outright. Threads follow the
round — open while voting is open, read-only once it closes. Deleting stays available
after that, so people can still take back their own words and admins can still act on a
report.

These are **not** the `/community` comments. That table trusts a display name out of the
request body, so anyone can post as anyone; it's kept as-is for the old page.

## Signing in

There are two ways the server can know who you are, and they coexist on purpose.

**osu! sign-in** is the real one: an authorization-code round trip to osu!, then a signed
JWT in an httpOnly cookie for 30 days. It carries your osu! id, username, avatar and
country flag, and it's what voting, commenting and the admin panel are built on. It's now
offered on `/` as well as `/vote` — the bounty form asks for it first.

**A display name** is the old one, and it still works on `/`. You type a name, the browser
keeps the uuid it was given in `localStorage` (`act_user_id`), and it's sent as an
`x-user-id` header. It proves nothing — whoever holds the uuid is that user — so it can
submit and edit bounties and nothing else.

Both are accepted as proof of ownership when you edit or delete your own bounty, because a
map submitted under a display name last year would otherwise become uneditable the moment
its owner signed in with osu! for the first time. That isn't a widening: before osu!
sign-in reached this page, the header alone was already enough. New submissions are filed
under the osu! account whenever there is one, so the data moves toward verified identities
without a migration.

Signing out clears the osu! session and **leaves the display name alone**. The uuid behind
it is unrecoverable — delete it and every bounty submitted under it is orphaned — so
forgetting it is not something a "sign out" click should do silently. Clear the site's
local storage if you actually want it gone.

Sign-in can start from either page, and osu! only knows one callback URL, so
`/api/auth/osu/login?next=/` records where to come back to in a short-lived cookie.
`next` is matched against a literal list of the site's four pages (`lib/returnTo.js`) and
anything else falls through to `/vote` — a "does it start with a slash" check would have
happily sent people to `//evil.com`.

## Setup

### 1. Register an osu! OAuth application

Go to <https://osu.ppy.sh/home/account/edit> → **OAuth** → **New OAuth Application**.

- **Application Name**: anything, e.g. `osu!dz`
- **Application Callback URL**: `http://localhost:3000/api/auth/osu/callback`

`OSU_REDIRECT_URI` must match this field **exactly** — same scheme, host, port and path.
If the form only accepts one callback URL, the simplest arrangement is two OAuth apps:
one with the localhost callback for local testing, one with
`https://your-app.onrender.com/api/auth/osu/callback` for the deployed site, each with
its own client id/secret in its own environment.

Copy the **Client ID** and **Client Secret**. The same application is used for reading
beatmap metadata (client credentials) and for signing users in (authorization code) —
you don't need a separate app for those two jobs.

### 2. Find your osu! user id

It's the number in your profile URL: `https://osu.ppy.sh/users/1234567` → `1234567`.
Put it in `ADMIN_OSU_IDS` to give yourself the admin panel.

### 3. Configure and run

```bash
cp .env.example .env      # then fill it in
npm install               # also builds the React voting client into public/vote/
npm run migrate           # creates the voting tables — safe to re-run
npm start                 # http://localhost:3000
npm test                  # unit tests: validation, vote eligibility, redirect allowlist
```

Only four values are actually required: `DATABASE_URL`, `OSU_CLIENT_ID`,
`OSU_CLIENT_SECRET` and `SESSION_SECRET`. Everything else in `.env.example` has a
working default for local development, and `DISCORD_WEBHOOK` can stay empty —
submissions still save, the Discord post is just skipped.

`npm run migrate` matters on an existing database as well as a new one: the discussion
threads and `users.country_code` both arrived after the first release, and `/vote` will
report a missing relation or block every vote until it has been run.

Against a local Postgres, TLS is turned off automatically (`localhost`, `127.0.0.1`
and `::1`); anything else gets TLS. `PGSSL=disable` or `PGSSL=require` overrides that
if your setup disagrees.

That first `npm install` adds `cookie-parser` and `jsonwebtoken` to
`package-lock.json` — **commit the updated lockfile**, otherwise `npm ci` (in CI, or
if you ever tighten Render's build command) fails with "package.json and
package-lock.json are not in sync".

`npm install` builds the client through a `postinstall` hook, which is what makes deploys
work with no extra build command. To rebuild the client on its own, run `npm run build`.
For UI work with hot reload, run `npm start` in one terminal and `npm run dev:client` in
another, then use the Vite URL (it proxies `/api` to port 3000).

### 4. Deploy on Render

- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Environment**: everything from `.env.example`, with
  `PUBLIC_BASE_URL=https://your-app.onrender.com` and
  `OSU_REDIRECT_URI=https://your-app.onrender.com/api/auth/osu/callback`

`PUBLIC_BASE_URL` starting with `https://` is what makes session cookies `Secure`, so get
it right in production. Run `npm run migrate` once (Render shell, or locally against the
same `DATABASE_URL`) before the first deploy that serves `/vote`.

## Running a round

1. Sign in with osu! on `/vote`, then click **Manage rounds**.
2. **New round** → title, month (`2026-09`), bounty, and when voting closes. It starts as a draft, invisible to players.
3. **Add from submissions** → put the shortlisted maps on the ballot.
4. **Open voting**. Only one round can be open at a time.
5. **Close voting** when the deadline passes. The highest tally wins; on a tie, use **Declare winner** on the map you choose.

## API

Public:

```
GET  /api/challenges/current          the round to display (204 when none)
GET  /api/challenges/:id/results      tallies + leader
POST /api/challenges/:id/vote         { beatmap_id }  — sign-in + eligible flag
GET  /api/auth/me                     current session
GET  /api/auth/osu/login              starts osu! sign-in; ?next= is where to land after
GET  /api/auth/osu/callback           osu! redirects back here
POST /api/auth/logout
```

`POST /vote` answers `403 { error, reason: "country" }` when the session's flag isn't on
the `VOTER_COUNTRIES` list — the `reason` field is there so the client can tell it apart
from the other 403s (round closed, map not on the ballot) without matching on the message.
`GET /api/auth/me` reports `country_code`, `can_vote`, `vote_blocked_reason` and
`vote_country_label`, which is what lets the ballot explain itself before anyone clicks.

Discussion — reading is open to guests, posting needs a session:

```
GET    /api/challenges/:id/candidates/:beatmapId/comments   the map's thread
POST   /api/challenges/:id/candidates/:beatmapId/comments   { body, parent_id? }
PATCH  /api/challenges/:id/comments/:commentId              { body } — author only
DELETE /api/challenges/:id/comments/:commentId              author, or any admin
```

`parent_id` may point at a reply; the reply is re-parented onto the top-level comment of
that group rather than refused. `PATCH` is author-only on purpose — an admin rewriting
someone's comment would put words in their mouth, so they get `DELETE` instead.

Admin (osu! id in `ADMIN_OSU_IDS`, or `users.is_admin = true`):

```
GET    /api/admin/challenges
GET    /api/admin/challenges/:id
POST   /api/admin/challenges                      { month, title, bounty, closes_at }
PATCH  /api/admin/challenges/:id                  partial update; status draft|open
                                                  (send "" to clear month/bounty)
POST   /api/admin/challenges/:id/candidates       { beatmap_id }
DELETE /api/admin/challenges/:id/candidates/:beatmapId
POST   /api/admin/challenges/:id/close            optional { winner_beatmap_id }
```

Bounty submissions (`/`) — either identity, see "Signing in":

```
POST   /api/users/register                        { display_name } — issues a legacy uuid
POST   /api/beatmaps/submit                       osu! session, or { submitted_by }
PUT    /api/beatmaps/:id                          owner only, by either identity
DELETE /api/beatmaps/:id                          owner only, by either identity
```

With an osu! session the body's `submitted_by` is ignored — the session decides, so it
can't be used to file a submission under someone else. Without one, it has to be a uuid
this server issued. Everything else about these endpoints, and the comment and osu!-proxy
endpoints, is unchanged.

`?next=` on the login route accepts `/`, `/vote`, `/community` and `/admin`; anything else
lands on `/vote` rather than being refused, so a stale link still signs you in.

## Request handling

Things that apply to every API route, so they're documented once rather than per endpoint:

- **Validation** — bodies go through `lib/validate.js`: fields are trimmed, capped per
  column, and URLs must be absolute `http(s)`. Ids that should be ours are checked as
  UUIDs, so a request can't invent a user row. `npm test` covers this layer.
- **Profanity** — display names, submission notes and comments are checked with
  `bad-words`. Set `PROFANITY_FILTER=off` to skip it. If the module fails to load the
  check is skipped rather than failing the request.
- **CORS** — credentialed requests are allowed from `PUBLIC_BASE_URL`, localhost `3000`
  and `5173`, plus anything in `EXTRA_CORS_ORIGINS`. Other origins are refused instead
  of being reflected back.
- **Rate limits** — reads 200 per 15 min, writes (register, submit, edit, delete, vote,
  comment) 40 per 10 min, the Discord relay 20 per min, all per IP. Relaxed when
  `NODE_ENV=development`.
- **Errors** — anything under `/api` answers with JSON, including 404s and malformed
  JSON bodies, so the front end never has to parse an HTML error page.

## Layout

```
server.js                 Express app: submissions, Discord, osu! proxy, auth, voting, admin
auth.js                   osu! session cookie (JWT), admin allowlist, user upsert
database.js               Postgres pool
lib/validate.js           input validation / normalisation (pure, unit tested)
lib/eligibility.js        who may vote — VOTER_COUNTRIES rule (pure, unit tested)
lib/returnTo.js           allowlist of pages sign-in may return to (pure, unit tested)
lib/profanity.js          bad-words wrapper, fails open, PROFANITY_FILTER=off disables
schema.sql                voting tables — idempotent
scripts/migrate.js        applies schema.sql
scripts/build-client.js   builds vote-client/ into public/vote/ (runs on npm install)
public/                   static pages + Bountiestyl.css theme
test/                     node:test unit tests (npm test)
vote-client/              React (Vite) source for /vote
```

## Troubleshooting

**`/vote` says "Voting page isn't built yet"** — run `npm run build`.

**Sign-in bounces back with `login_error=bad_state`** — the state cookie expired or was
dropped. Usually `PUBLIC_BASE_URL` is `https://` while you're browsing over `http://`,
which makes the cookie `Secure` and unsendable. Match it to how you actually load the site.

**`login_error=exchange_failed`** — `OSU_REDIRECT_URI` doesn't exactly match a callback URL
on the osu! app, or the client secret is wrong. Check the server logs for osu!'s reply.

**"Manage rounds" doesn't appear** — your osu! id isn't in `ADMIN_OSU_IDS`. Sign out and
back in after changing it.

**Sign-in from `/` lands on `/vote`** — the `?next=` value wasn't one of the four pages on
the allowlist in `lib/returnTo.js`, or the return cookie expired (10 minutes). Both fall
back to the ballot rather than failing, so you're signed in either way.

**Signing out on `/` left my display name behind** — deliberate. That name is backed by a
uuid only your browser holds, and deleting it orphans every bounty submitted under it.
Clear the site's local storage if you want it gone for real.

**A bounty I submitted under a display name still shows Edit and Delete after I sign in
with osu!** — also deliberate. Ownership is accepted from either identity, so signing in
doesn't take your own submissions away from you. New ones are filed under the osu! account.

**Everyone got signed out after a deploy** — expected once, when the country rule shipped.
See "Who may vote" above; `SESSION_VERSION` in `auth.js` invalidates cookies that predate
the country claim. It only happens on the deploy that bumps it.

**The ballot says "Algeria only" and it shouldn't** — either the osu! profile flag really
isn't `DZ`, or the session predates the flag being stored. Sign out and back in first; the
server logs the country it read at each login (`🔑 osu! login: … [DZ]`), and `no country`
there means osu! didn't return one. To test from outside Algeria, set `VOTER_COUNTRIES=any`
and restart — an empty value is not the same thing.

**A signed-in player can comment but not vote** — that's the design, not a bug. Reading and
discussion are open to everyone; only the vote is limited by flag.

**Migration fails on `users_osu_id_key`** — two existing user rows share an `osu_id`.
That shouldn't happen on a fresh install; deduplicate before re-running.

**Migration fails with "foreign key constraint cannot be implemented"** — the live
`beatmaps.id` is a `bigint` while `schema.sql` declares the referencing columns as
`integer`. Change `winner_beatmap_id` and the three `beatmap_id` columns in `schema.sql`
to `BIGINT` and re-run.

**A map's discussion won't load, or the API says `relation "challenge_comments" does not
exist`** — that table arrived with the discussion feature. Run `npm run migrate`; it's
idempotent, so it only adds what's missing.

**Migration fails on `challenges_single_open`** — that unique index makes "only one open
round" a rule the database enforces, and a live database can already have two rows with
`status = 'open'` from before it existed. Close or draft all but one, then re-run the
migration:

```sql
SELECT id, title, month FROM challenges WHERE status = 'open';
UPDATE challenges SET status = 'draft' WHERE id = <the ones you don't want open>;
```

**Requests from another domain fail CORS** — only `PUBLIC_BASE_URL` and localhost are
allowed by default. Add the origin to `EXTRA_CORS_ORIGINS` (comma separated, no trailing
slash) and restart.

**A round is stuck** — the ballot is locked once a round is closed (removing maps would
erase the tally and orphan the winner). Set it back to draft first; that also clears the
recorded winner.
