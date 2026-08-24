<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Bounties</title>
  <link rel="stylesheet" href="Bountiestyl.css" />
</head>

<body>
  <nav>
    <a href="/" class="active">💰 Submit Bounties</a>
    <a href="/admin">📝 Mappool Suggestions</a>
    <a href="/vote">🗳️ Vote</a>
  </nav>

  <div class="container">
    <!-- Both filled in by JS. They start hidden so the page never flashes a
         "Sign in" button at someone who is already signed in, or an empty bar
         while /api/auth/me is still in flight. -->
    <div class="auth-notice" id="auth-notice" role="alert" hidden></div>
    <div class="authbar" id="authbar" hidden></div>

    <div class="header">
      <h1>Bounties Submission</h1>
      <p>Submit a Beatmap for The Next Challenge</p>
    </div>

    <div class="form-section">
      <div class="form-grid">
        <div class="form-group">
          <label>Beatmap URL</label>
          <input id="url" maxlength="500" placeholder="https://osu.ppy.sh/beatmapsets/...#osu/..." />
        </div>

        <div class="form-group">
          <label>Challenge</label>
          <input id="challenge" maxlength="80" placeholder="Pass, FC, #1 Algeria, Best Acc" />
        </div>

        <div class="form-group">
          <label>Mods</label>
          <input id="mods" maxlength="40" placeholder="e.g. NM, HD, HR, DT" />
        </div>

        <div class="form-group">
          <label>Map Difficulty</label>
          <input id="difficulty" maxlength="40" placeholder="e.g. Insane, Expert" />
        </div>

        <div class="form-group">
          <label>Song Title</label>
          <input id="title" readonly />
        </div>
      </div>

      <div class="stats-grid">
        <div class="form-group">
          <label>Stars</label>
          <input id="stars" readonly />
        </div>

        <div class="form-group">
          <label>CS</label>
          <input id="cs" readonly />
        </div>

        <div class="form-group">
          <label>AR</label>
          <input id="ar" readonly />
        </div>

        <div class="form-group">
          <label>OD</label>
          <input id="od" readonly />
        </div>

        <div class="form-group">
          <label>BPM</label>
          <input id="bpm" readonly />
        </div>

        <div class="form-group">
          <label>Length</label>
          <input id="length" readonly />
        </div>
      </div>

      <div class="action-buttons">
        <button class="btn btn-primary" id="addBountyBtn">➕ Submit Bounty</button>
      </div>
    </div>

    <div class="output-section">
      <h2 class="section-title">🗂️ Current Beatmaps (<span id="count">0</span>)</h2>
      <div id="output"></div>
    </div>
  </div>

  <div id="user-registration-modal">
    <div class="modal-content">
      <h2>👋 Welcome!</h2>
      <p>Sign in with osu! so your submissions carry your actual profile.</p>

      <!-- ?next=/ brings you back here instead of to the ballot; the server
           only honours a path it recognises (see lib/returnTo.js). -->
      <a class="btn-osu" id="modal-login" href="/api/auth/osu/login?next=/">Sign in with osu!</a>

      <p class="modal-hint" id="modal-login-unavailable" hidden>
        osu! sign-in isn't available right now — you can still use a display name below.
      </p>

      <!-- The old name-only path, kept rather than removed: people submitted
           maps under one of these before osu! sign-in reached this page, and
           that id is the only thing that still proves those maps are theirs.
           Demoted to a fold-out because it verifies nothing. -->
      <details class="modal-legacy" id="modal-legacy">
        <summary>Continue with just a display name</summary>
        <p class="modal-hint">
          No osu! account is checked, so a name claimed this way can't vote and won't be
          tied to your profile.
        </p>
        <form id="registration-form">
          <input
            type="text"
            id="username-input"
            placeholder="Username"
            required
            minlength="3"
            maxlength="20"
            autocomplete="off"
          />
          <br />
          <button type="submit">Start Browsing</button>
        </form>
      </details>

      <button type="button" class="modal-dismiss" id="modal-dismiss">Just browsing, thanks</button>
    </div>
  </div>

  <script>
    let bounties = [];
    let currentAudio = null;
    let editingBountyId = null;

    // What /api/auth/me last told us. null until it answers — nothing that
    // depends on identity should render before then, or the page shows a Sign
    // in button to someone who is already signed in and hides the Edit buttons
    // on their own maps.
    let session = null;

    const LOGIN_URL = "/api/auth/osu/login?next=/";

    const LOGIN_ERRORS = {
      bad_state: "That sign-in attempt expired. Please try again.",
      exchange_failed: "osu! wouldn't confirm that sign-in. Check the server's OAuth keys, then try again.",
      not_configured: "osu! sign-in isn't set up on this server yet.",
      access_denied: "Sign-in cancelled — you're still browsing as a guest.",
    };

    function extractId(url) {
      const match = String(url || "").match(/osu\/(\d+)/);
      return match ? match[1] : null;
    }

    function extractSetId(url) {
      const match = String(url || "").match(/beatmapsets\/(\d+)/);
      return match ? match[1] : null;
    }

    function beatmapIdFromOsuUrl(url) {
      if (!url) return null;
      const s = String(url);
      const m = s.match(/#osu\/(\d+)/) || s.match(/osu\/(\d+)/);
      return m ? m[1] : null;
    }
    
    function safeStr(x) {
      return (x === null || x === undefined) ? "" : String(x);
    }

    // Submitted titles, notes and names are typed by other people and land in
    // innerHTML below, so every one of them goes through here first. Without
    // it a title of `<img src=x onerror=alert(1)>` runs for every visitor.
    function esc(x) {
      return safeStr(x)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }

    // Same idea for attributes that are URLs: escaping isn't enough, because
    // `javascript:alert(1)` needs no special characters at all. Absolute
    // http(s) links only — which also filters out the placeholder "/" that
    // older submissions stored in preview_url.
    function safeUrl(x) {
      const raw = safeStr(x).trim();
      if (!raw) return "";
      try {
        const parsed = new URL(raw);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
        return esc(parsed.href);
      } catch {
        return "";
      }
    }

    // ---------- who am I ----------
    //
    // Two identities can apply on this page, and both are real:
    //
    //   osu! session   — a cookie the server signed. The one that counts.
    //   act_user_id    — the uuid /api/users/register handed out, replayed from
    //                    localStorage. It verifies nothing, but it's the only
    //                    proof of ownership for maps submitted before osu!
    //                    sign-in reached this page, so it isn't thrown away.
    //
    // Strongest first: the head of this list is what a new submission is filed
    // under, and the whole list is what "is this map mine" is checked against.
    function myIds() {
      return [session?.user_id, localStorage.getItem("act_user_id")].filter(Boolean);
    }

    function legacyName() {
      return localStorage.getItem("act_username");
    }

    function myName() {
      return session?.username || legacyName() || "Unknown";
    }

    function haveIdentity() {
      return myIds().length > 0;
    }

    // The session cookie rides along on its own (same-origin fetch), so this
    // only adds the legacy id — and only when there is one. Sending the string
    // "null" is exactly the case the server had to write a guard for.
    function authHeaders(extra = {}) {
      const legacy = localStorage.getItem("act_user_id");
      return legacy ? { ...extra, "x-user-id": legacy } : { ...extra };
    }

    async function readSession() {
      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) throw new Error(String(res.status));
        return await res.json();
      } catch {
        // Offline, rate limited, or an old server without the endpoint. Treated
        // as signed out with sign-in unavailable, which is the honest reading:
        // we couldn't ask, so we don't offer a button that may not work.
        return { authenticated: false, login_configured: false };
      }
    }

    function renderAuthBar() {
      const bar = document.getElementById("authbar");
      if (!bar || !session) return;

      if (session.authenticated) {
        const avatar = safeUrl(session.avatar_url);
        bar.innerHTML = `
          <div class="authbar__who">
            ${avatar ? `<img class="authbar__avatar" src="${avatar}" alt="">` : ""}
            <div>
              <strong>${esc(session.username)}</strong>
              <span class="authbar__id">osu! #${esc(session.osu_id)}</span>
            </div>
          </div>
          <div class="authbar__actions">
            <a class="btn-small btn-ghost" href="/vote">🗳️ Go vote</a>
            <button type="button" class="btn-small btn-ghost" data-auth="logout">Sign out</button>
          </div>`;
      } else if (session.login_configured) {
        const name = legacyName();
        bar.innerHTML = `
          <span class="authbar__hint">
            ${name
              ? `Submitting as <strong>${esc(name)}</strong> — a display name only, not a verified osu! account.`
              : "You're browsing as a guest."}
          </span>
          <a class="btn-osu" href="${LOGIN_URL}">Sign in with osu!</a>`;
      } else {
        bar.innerHTML = `
          <span class="authbar__hint">
            osu! sign-in isn't available right now — you can still submit with a display name.
          </span>`;
      }

      bar.querySelector('[data-auth="logout"]')?.addEventListener("click", signOut);
      bar.hidden = false;
    }

    async function signOut() {
      try {
        await fetch("/api/auth/logout", { method: "POST" });
      } catch {
        // The cookie may already be gone, or we're rate limited. The local
        // state below is what the user sees either way.
      }

      // Note what is deliberately *not* cleared: act_user_id. It's an
      // unrecoverable bearer token — delete it and any maps submitted under it
      // become uneditable forever. Signing out of osu! drops back to that
      // identity rather than destroying it.
      session = { authenticated: false, login_configured: true };
      renderAuthBar();
      renderOutput();
    }

    function showLoginError() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("login_error");
      if (!code) return;

      const box = document.getElementById("auth-notice");
      // textContent, not innerHTML: `code` comes straight off the address bar.
      box.textContent = LOGIN_ERRORS[code] || `Sign-in failed (${code}).`;
      box.hidden = false;

      // Take it out of the address bar so a refresh doesn't keep reporting a
      // failure that's already been read.
      window.history.replaceState({}, "", window.location.pathname);
    }

    function fetchInfo() {
      const url = document.getElementById("url").value;
      const id = extractId(url);
      const setId = extractSetId(url);
      if (!id) return;

      const inputs = ['title', 'stars', 'cs', 'ar', 'od', 'bpm', 'length'];
      inputs.forEach(k => {
        const el = document.getElementById(k);
        el.value = 'Loading...';
        el.classList.add('loading');
      });

      fetch("/api/beatmap/" + id)
        .then(async r => {
          const body = await r.json().catch(() => ({}));
          // On a 404/502 the body is { error }. Without this check the fields
          // were quietly blanked and the reason was only in the console.
          if (!r.ok) throw new Error(body.error || `Lookup failed (${r.status})`);
          return body;
        })
        .then(d => {
          document.getElementById("title").value = d.title || "";
          document.getElementById("stars").value = safeStr(d.stars ?? "").replace("★", "").replace("⭐", "");
          document.getElementById("cs").value = d.cs ?? "N/A";
          document.getElementById("ar").value = d.ar ?? "N/A";
          document.getElementById("od").value = d.od ?? "N/A";
          document.getElementById("bpm").value = d.bpm ?? "N/A";
          document.getElementById("length").value = d.length ?? "N/A";

          // Empty string, not "/": the server stores http(s) links only, and a
          // bare "/" used to end up behind a dead Preview button.
          const fallbackPreview = setId ? `https://b.ppy.sh/preview/${setId}.mp3` : "";
          const fallbackCover = setId ? `https://assets.ppy.sh/beatmaps/${setId}/covers/cover.jpg` : "";

          // Everything the lookup returns that has no input of its own. These
          // ride along to the server on submit; the ballot card on /vote shows
          // the artist, mapper and difficulty on their own lines, and HP drain
          // next to the other four difficulty settings.
          window.currentBeatmapData = {
            preview_url: d.preview_url || fallbackPreview,
            cover_url: d.cover_url || fallbackCover,
            length: d.length ?? "N/A",
            artist: d.artist || "",
            mapper: d.mapper || "",
            difficulty_name: d.difficulty_name || "",
            hp: d.hp ?? "N/A"
          };

          inputs.forEach(k => document.getElementById(k).classList.remove('loading'));
        })
        .catch(err => {
          console.error("Beatmap fetch failed:", err);
          inputs.forEach(k => {
            const el = document.getElementById(k);
            el.value = '';
            el.classList.remove('loading');
          });
          window.currentBeatmapData = null;
          alert(err.message || "Couldn't fetch beatmap info. Please check the URL.");
        });
    }

    async function loadBounties() {
      try {
        const res = await fetch('/api/beatmaps/list');
        const data = await res.json();
        bounties = (Array.isArray(data) ? data : []).filter(x => x.type === "bounty");
        renderOutput();
      } catch (err) {
        console.error("Failed to load bounties:", err);
      }
    }

 function renderOutput() {
      const out = document.getElementById("output");
      const count = document.getElementById("count");
      if (!out || !count) return;

      // Every id this browser can act as, worked out once instead of per card.
      // A row with no owner belongs to nobody, so it can never match — the same
      // rule the server applies, and the reason for the Boolean() guard.
      const mine = myIds();

      count.textContent = bounties.length;
      out.innerHTML = "";

      // Built as one string and assigned once — `innerHTML +=` re-parsed the
      // whole list on every card, which is quadratic and also throws away the
      // nodes the click handlers were about to be attached to.
      out.innerHTML = bounties.map((m) => {
        const isOwner = Boolean(m.submitted_by) && mine.some((id) => String(m.submitted_by) === String(id));
        const bmId = beatmapIdFromOsuUrl(m.url);
        const cover = safeUrl(m.cover_url);
        const mapUrl = safeUrl(m.url);
        const previewUrl = safeUrl(m.preview_url);

        return `
          <div class="beatmap-card">
            ${cover ? `<img src="${cover}" alt="Cover" class="cover-image" data-cover="1">` : ''}

            <div class="beatmap-header">
              <div>
                <span class="slot-badge">${esc(m.slot)}</span>
              </div>
              <div style="font-size: 0.9rem; color: #94a3b8;">${esc(m.mod)}</div>
            </div>

            <a href="${mapUrl || '#'}" target="_blank" rel="noopener noreferrer"
               class="beatmap-title" style="text-decoration: none; color: #f1f5f9;">
              ${esc(m.title) || 'Unknown title'}
            </a>

            <div class="beatmap-stats">
              <div class="stat-item"><span class="stat-label">Stars</span><span class="stat-value">${esc(m.stars ?? 'N/A')}</span></div>
              <div class="stat-item"><span class="stat-label">CS</span><span class="stat-value">${esc(m.cs ?? 'N/A')}</span></div>
              <div class="stat-item"><span class="stat-label">AR</span><span class="stat-value">${esc(m.ar ?? 'N/A')}</span></div>
              <div class="stat-item"><span class="stat-label">OD</span><span class="stat-value">${esc(m.od ?? 'N/A')}</span></div>
              <div class="stat-item"><span class="stat-label">BPM</span><span class="stat-value">${esc(m.bpm ?? 'N/A')}</span></div>
              <div class="stat-item"><span class="stat-label">Length</span><span class="stat-value">${esc(m.length ?? 'N/A')}</span></div>
            </div>

            <div style="margin-top: 0.5rem;">
              ${m.skill ? `<span class="skill-tag">🎯 ${esc(m.skill)}</span>` : ''}
              <div style="margin-top: 0.25rem; font-size: 0.85rem; color: #60a5fa;">
                👤 Submitted by: ${esc(m.submitted_by_name) || 'Unknown'}
              </div>
            </div>

            <div class="beatmap-actions" style="margin-top: 0.5rem;">
              ${isOwner ? `
                <button class="btn-small btn-edit" data-action="edit" data-id="${esc(m.id)}">✏️ Edit</button>
                <button class="btn-small btn-delete" data-action="delete" data-id="${esc(m.id)}">🗑️ Delete</button>
              ` : ''}

              ${previewUrl ? `
                <button class="btn-small btn-preview" data-action="preview" data-preview="${previewUrl}">🔊 Preview</button>
              ` : ''}

              ${bmId ? `
                <button class="btn-small btn-replay" data-action="replay" data-b="${esc(bmId)}">🎬 Replay (JoSu!)</button>
              ` : ''}
            </div>
          </div>
        `;
      }).join('');

  out.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;

      if (action === "edit") {
        editBounty(btn.dataset.id);
      } else if (action === "delete") {
        deleteBounty(btn.dataset.id);
      } else if (action === "preview") {
        playPreview(btn.dataset.preview);
      } else if (action === "replay") {
        openReplayPreview(btn.dataset.b);
      }
    });
  });
}

  function openReplayPreview(beatmapId) {
  const url = `https://preview.tryz.id.vn/?b=${encodeURIComponent(beatmapId)}&m=`;
  window.open(url, "_blank", "noopener,noreferrer");
}

    function playPreview(previewUrl) {
      try {
        if (currentAudio) currentAudio.pause();
        currentAudio = new Audio(previewUrl);
        currentAudio.volume = 0.5;
        currentAudio.play().catch((e) => {
          console.error("Preview error:", e);
          alert("Could not play preview (browser may block it).");
        });

        setTimeout(() => {
          if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
          }
        }, 30000);
      } catch (e) {
        console.error(e);
        alert("Preview failed.");
      }
    }


    function editBounty(id) {
      const b = bounties.find(x => String(x.id) === String(id));
      if (!b) return;

      editingBountyId = b.id;

      document.getElementById("url").value = b.url || "";
      document.getElementById("challenge").value = b.skill || "";
      document.getElementById("mods").value = b.mod || "";
      document.getElementById("difficulty").value = b.slot || "";

      document.getElementById("title").value = b.title || "";
      document.getElementById("stars").value = b.stars ?? "";
      document.getElementById("cs").value = b.cs ?? "";
      document.getElementById("ar").value = b.ar ?? "";
      document.getElementById("od").value = b.od ?? "";
      document.getElementById("bpm").value = b.bpm ?? "";
      document.getElementById("length").value = b.length ?? "";

      // Carried through an edit rather than re-fetched. Without this the save
      // would post them as empty and blank the row's artist, mapper, difficulty
      // and HP — the edit form has no inputs for them, so there'd be nothing on
      // screen to show what had just been lost.
      window.currentBeatmapData = {
        preview_url: b.preview_url || "",
        cover_url: b.cover_url || "",
        artist: b.artist || "",
        mapper: b.mapper || "",
        difficulty_name: b.difficulty_name || "",
        hp: b.hp ?? ""
      };

      const btn = document.getElementById('addBountyBtn');
      btn.innerText = "💾 Save Changes";

      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    async function deleteBounty(id) {
      if (!haveIdentity()) return alert("Sign in with osu! first.");

      const ok = confirm("Are you sure you want to delete this beatmap?");
      if (!ok) return;

      try {
        const res = await fetch(`/api/beatmaps/${id}`, {
          method: "DELETE",
          headers: authHeaders({ "Content-Type": "application/json" })
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          alert("Delete failed: " + (data.error || "Not allowed"));
          return;
        }

        if (String(editingBountyId) === String(id)) {
          editingBountyId = null;
          document.getElementById('addBountyBtn').innerText = "➕ Submit Bounty";
        }

        loadBounties();
      } catch (err) {
        console.error(err);
        alert("Delete failed: network error");
      }
    }


    async function addBounty() {
      if (!haveIdentity()) {
        document.getElementById('user-registration-modal').style.display = 'flex';
        return;
      }

      const entry = {
        url: document.getElementById("url").value,
        skill: document.getElementById("challenge").value,
        mod: document.getElementById("mods").value,
        slot: document.getElementById("difficulty").value,
        title: document.getElementById("title").value,
        stars: document.getElementById("stars").value,
        cs: document.getElementById("cs").value,
        ar: document.getElementById("ar").value,
        od: document.getElementById("od").value,
        bpm: document.getElementById("bpm").value,
        length: document.getElementById("length").value,
        preview_url: window.currentBeatmapData?.preview_url || "",
        cover_url: window.currentBeatmapData?.cover_url || "",
        // Filled in by the osu! lookup, not by hand — there are no inputs for
        // these. Posting them keeps the ballot card's four separate lines and
        // its HP row populated for anything submitted from here.
        artist: window.currentBeatmapData?.artist || "",
        mapper: window.currentBeatmapData?.mapper || "",
        difficulty_name: window.currentBeatmapData?.difficulty_name || "",
        hp: window.currentBeatmapData?.hp || "",
        type: "bounty",
        // The server ignores both of these when the session cookie is present
        // and uses the osu! account instead — they're here for the name-only
        // path, and for the Discord embed below.
        submitted_by: myIds()[0],
        submitted_by_name: myName()
      };

      if (!entry.url || !entry.skill) {
        alert("Please fill in the Beatmap URL and Challenge.");
        return;
      }

      const btn = document.getElementById('addBountyBtn');
      btn.disabled = true;

      const isEdit = editingBountyId !== null;
      btn.innerText = isEdit ? "Saving..." : "Submitting...";

      try {
        const endpoint = isEdit ? `/api/beatmaps/${editingBountyId}` : `/api/beatmaps/submit`;
        const method = isEdit ? "PUT" : "POST";

        const response = await fetch(endpoint, {
          method,
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(entry)
        });

        const result = await response.json();

        if (response.ok) {
          if (!isEdit) {
            sendToDiscord(entry);
            alert('Bounty Submitted Successfully!');
          } else {
            alert('Changes Saved!');
          }

          editingBountyId = null;
          btn.innerText = "➕ Submit Bounty";

          loadBounties();

          ['url','challenge','mods','difficulty','title','stars','cs','ar','od','bpm','length'].forEach(id => {
            document.getElementById(id).value = '';
          });
          window.currentBeatmapData = null;
        } else {
          alert('Error: ' + (result.error || "Unknown error"));
        }
      } catch (err) {
        console.error(err);
        alert('Failed to connect to server');
      } finally {
        btn.disabled = false;
        btn.innerText = (editingBountyId === null) ? "➕ Submit Bounty" : "💾 Save Changes";
      }
    }

    function sendToDiscord(entry) {
      fetch("/api/send-discord", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(entry)
      }).catch(err => console.error("Discord error:", err));
    }


    async function registerName(e) {
      e.preventDefault();
      const modal = document.getElementById('user-registration-modal');
      const username = document.getElementById('username-input').value.trim();
      if (username.length < 3) return alert('Name too short!');

      try {
        const response = await fetch('/api/users/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ display_name: username })
        });

        const data = await response.json();

        if (response.ok) {
          localStorage.setItem('act_user_id', data.id);
          localStorage.setItem('act_username', data.display_name);
          localStorage.setItem('act_is_admin', data.is_admin);

          modal.style.display = 'none';
          alert(`Welcome, ${data.display_name}!`);

          // The bar and the Edit buttons both read the identity that just
          // changed, so both are redrawn.
          renderAuthBar();
          loadBounties();
        } else {
          alert(data.error || 'Registration failed');
        }
      } catch (error) {
        console.error(error);
        alert('Failed to connect to server.');
      }
    }

    document.addEventListener('DOMContentLoaded', async () => {
      document.getElementById('url').addEventListener('blur', fetchInfo);
      document.getElementById('addBountyBtn').addEventListener('click', addBounty);
      document.getElementById('registration-form').addEventListener('submit', registerName);

      const modal = document.getElementById('user-registration-modal');
      document.getElementById('modal-dismiss').addEventListener('click', () => {
        modal.style.display = 'none';
      });

      showLoginError();

      // The list doesn't need a session to render, so it's started first and
      // waited on afterwards rather than queued behind /api/auth/me. Identity
      // still has to be settled before renderOutput() decides which cards get
      // an Edit button — hence the second render once both have landed.
      const listed = loadBounties();
      session = await readSession();
      renderAuthBar();
      await listed;
      renderOutput();

      if (!session.login_configured) {
        document.getElementById('modal-login').hidden = true;
        document.getElementById('modal-login-unavailable').hidden = false;
        document.getElementById('modal-legacy').open = true;
      }

      // Only when we have no idea who this is. Someone signed in with osu!, or
      // holding a name from a previous visit, has already answered this.
      if (!haveIdentity()) modal.style.display = 'flex';
    });
  </script>
</body>
</html>
