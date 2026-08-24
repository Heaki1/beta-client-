import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import useAudioPreview from "./useAudioPreview.js";
import SiteNav from "./components/SiteNav.jsx";
import LoginBar from "./components/LoginBar.jsx";
import ChallengeHeader from "./components/ChallengeHeader.jsx";
import CandidateGrid from "./components/CandidateGrid.jsx";
import WinnerBanner from "./components/WinnerBanner.jsx";
import AdminPanel from "./components/AdminPanel.jsx";

const REFRESH_MS = 30000;

const LOGIN_ERRORS = {
  bad_state: "That sign-in attempt expired. Please try again.",
  exchange_failed: "osu! wouldn't confirm that sign-in. Check the server's OAuth keys, then try again.",
  not_configured: "osu! sign-in isn't set up on this server yet.",
  access_denied: "Sign-in cancelled — you're still browsing as a guest.",
};

export default function App() {
  const [session, setSession] = useState(null); // null while loading
  const [challenge, setChallenge] = useState(undefined); // undefined = loading, null = no round
  const [loadError, setLoadError] = useState(null);
  const [notice, setNotice] = useState(null); // { kind: "ok" | "error", text }
  const [votingFor, setVotingFor] = useState(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const preview = useAudioPreview();

  const loadChallenge = useCallback(async () => {
    try {
      setChallenge(await api.currentChallenge());
      setLoadError(null);
    } catch (err) {
      setLoadError(err.message);
      setChallenge(null);
    }
  }, []);

  // Initial load
  useEffect(() => {
    (async () => {
      try {
        setSession(await api.me());
      } catch {
        setSession({ authenticated: false, login_configured: false });
      }
      await loadChallenge();
    })();
  }, [loadChallenge]);

  // Surface an OAuth failure once, then clean it out of the address bar.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("login_error");
    if (!code) return;
    setNotice({ kind: "error", text: LOGIN_ERRORS[code] || `Sign-in failed (${code}).` });
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  // Keep tallies fresh without hammering the server. A hidden tab doesn't
  // poll at all — nobody is reading it, and the requests still count against
  // the rate limit for whenever they come back.
  useEffect(() => {
    const tick = () => {
      if (document.hidden || votingFor || showAdmin) return;
      loadChallenge();
    };
    const timer = setInterval(tick, REFRESH_MS);

    // Coming back to the tab should show current numbers straight away rather
    // than up to 30s of stale ones.
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadChallenge, votingFor, showAdmin]);

  // The moment the deadline passes, refetch once so the ballot flips to its
  // closed state. Without this the vote buttons kept working (visually — the
  // server refused them) until the next 30s poll came round.
  useEffect(() => {
    if (!challenge?.closes_at || challenge.voting_closed) return;
    const msLeft = new Date(challenge.closes_at).getTime() - Date.now();
    if (Number.isNaN(msLeft)) return;
    const timer = setTimeout(loadChallenge, Math.max(msLeft, 0) + 1000);
    return () => clearTimeout(timer);
  }, [challenge?.closes_at, challenge?.voting_closed, loadChallenge]);

  const handleVote = useCallback(
    async (beatmapId) => {
      if (!session?.authenticated) {
        setNotice({ kind: "error", text: "Sign in with osu! to vote." });
        return;
      }
      // The card already disables its button for an ineligible player, so this
      // is the backstop for anything that gets past it. The server checks too —
      // this only exists to answer with the reason instead of a bare 403.
      if (session.can_vote === false) {
        setNotice({
          kind: "error",
          text: session.vote_blocked_reason || "You're not eligible to vote in this round.",
        });
        return;
      }
      setVotingFor(beatmapId);
      try {
        const result = await api.castVote(challenge.id, beatmapId);
        setChallenge((current) => ({
          ...current,
          candidates: result.candidates,
          my_vote: result.my_vote,
          total_voters: result.total_voters,
        }));
        setNotice({ kind: "ok", text: "Vote counted. You can change it until voting closes." });
      } catch (err) {
        setNotice({ kind: "error", text: err.message });
        // The server refused on a rule this session didn't know it was failing,
        // which happens when the flag changed after sign-in. Re-read the session
        // so the buttons stop offering something that won't work. Failures here
        // are ignored on purpose: the error above is already on screen.
        if (err.reason === "country") {
          api.me().then(setSession, () => {});
        }
      } finally {
        setVotingFor(null);
      }
    },
    [challenge, session]
  );

  const handleLogout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // The cookie may already be gone, or we're rate limited. Either way the
      // local state below is what the user sees, so don't leave a rejection
      // dangling from the click handler.
    }
    setShowAdmin(false);
    setSession({ authenticated: false, login_configured: true });
    await loadChallenge();
  }, [loadChallenge]);

  const loading = session === null || challenge === undefined;

  // "Vote counted" doesn't need to sit there for the rest of the session.
  // Errors stay until dismissed, because they usually need acting on.
  useEffect(() => {
    if (notice?.kind !== "ok") return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <>
      <SiteNav />

      <div className="container">
        <LoginBar
          session={session}
          onLogout={handleLogout}
          showAdmin={showAdmin}
          onToggleAdmin={() => setShowAdmin((v) => !v)}
        />

        {notice && (
          <div
            className={`notice notice--${notice.kind}`}
            // A failed vote is worth interrupting a screen reader for; a
            // confirmation isn't.
            role={notice.kind === "error" ? "alert" : "status"}
            aria-live={notice.kind === "error" ? "assertive" : "polite"}
          >
            <span>{notice.text}</span>
            <button type="button" className="notice__close" onClick={() => setNotice(null)} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}

        {loading && (
          <p className="muted" role="status">
            Loading this month's ballot…
          </p>
        )}

        {!loading && showAdmin && session?.is_admin && (
          <AdminPanel onChanged={loadChallenge} onNotice={setNotice} />
        )}

        {!loading && !showAdmin && (
          <>
            {loadError && (
              <div className="notice notice--error">
                <span>Couldn't load the round: {loadError}</span>
              </div>
            )}

            {!challenge && !loadError && (
              <section className="empty-state">
                <h1>No round is open yet</h1>
                <p>
                  When the next Beatmap of the Month opens, the shortlist shows up here and you get one vote to
                  spend. Until then, <a href="/">submit a bounty</a> and it might make the ballot.
                </p>
              </section>
            )}

            {challenge && (
              <>
                <ChallengeHeader challenge={challenge} />

                {challenge.status === "closed" && <WinnerBanner challenge={challenge} />}

                {/* Said once, above the grid, rather than on all twelve cards.
                    Only while the round is open — after it closes nobody can
                    vote and the restriction stops being the reason why. */}
                {!challenge.voting_closed && session?.authenticated && session.can_vote === false && (
                  <div className="notice notice--info" role="status">
                    <span>
                      {session.vote_blocked_reason} You can still read the ballot, play the previews and join
                      the discussion on any map.
                    </span>
                  </div>
                )}

                <CandidateGrid
                  challenge={challenge}
                  session={session}
                  votingFor={votingFor}
                  onVote={handleVote}
                  preview={preview}
                />
              </>
            )}
          </>
        )}
      </div>

      <footer className="vote-footer">
        <span>
          One vote per osu! account
          {/* Absent when the restriction isn't running, so this line never
              claims a rule the server isn't enforcing. */}
          {session?.vote_country_label ? ` · ${session.vote_country_label} flag only` : ""} · votes can be
          changed until the round closes
        </span>
      </footer>
    </>
  );
}
