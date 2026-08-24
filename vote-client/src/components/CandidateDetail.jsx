import { LOGIN_URL } from "../api.js";
import { plural, sharePercent, value } from "../format.js";
import { readableInk, songName, starColour, starLabel, tierName } from "../difficulty.js";
import CommentThread from "./CommentThread.jsx";

// The full reading of one map, and the only place on the ballot with controls
// in it. The cards in the fan above are tabs; this is their panel.
//
// The stats are spelled out here, with the shorthand printed beside each one.
// The card face only has room for "AR", so this is where a player who doesn't
// already know the abbreviations learns them — the panel and the card teach
// each other.
const STATS = [
  ["Length", null, "length"],
  ["Circle size", "CS", "cs"],
  ["Approach rate", "AR", "ar"],
  ["Accuracy", "OD", "od"],
  ["HP drain", "HP", "hp"],
  ["Tempo", "BPM", "bpm"],
];

export default function CandidateDetail({
  candidate,
  challenge,
  session,
  isBusy,
  onVote,
  preview,
  panelId,
  tabId,
}) {
  const accent = starColour(candidate.stars);
  const ink = readableInk(accent);
  const tier = tierName(candidate.stars);
  const song = songName(candidate);

  const picked = challenge.my_vote === candidate.beatmap_id;
  const share = sharePercent(candidate.votes, challenge.total_voters);
  const playing = preview.playingUrl === candidate.preview_url;

  function voteControl() {
    if (challenge.voting_closed) {
      return (
        <span className="vote-btn vote-btn--muted" aria-disabled="true">
          {picked ? "✓ You picked this" : "Voting closed"}
        </span>
      );
    }
    if (!session?.authenticated) {
      return (
        <a className="vote-btn vote-btn--signin" href={LOGIN_URL}>
          Sign in to vote
        </a>
      );
    }
    // Signed in, but the country on the osu! profile isn't one that may vote.
    // Checked ahead of the "your pick" branch below: a player in this state
    // can't change their mind, so saying why beats showing a tick they can't
    // act on. `=== false` and not `!can_vote`, so a response from a server
    // that predates the field doesn't grey out every button on the page.
    if (session.can_vote === false) {
      return (
        <span className="vote-btn vote-btn--blocked" aria-disabled="true">
          {picked ? "✓ Your pick · locked" : `${session.vote_country_label || "DZ"} only`}
        </span>
      );
    }
    if (picked) {
      return (
        <span className="vote-btn vote-btn--picked" aria-disabled="true">
          ✓ Your pick
        </span>
      );
    }
    return (
      <button type="button" className="vote-btn" disabled={isBusy} onClick={() => onVote(candidate.beatmap_id)}>
        {isBusy ? "Saving…" : challenge.my_vote ? "Switch to this map" : "Vote for this map"}
      </button>
    );
  }

  return (
    <div
      className="detail"
      id={panelId}
      role="tabpanel"
      aria-labelledby={tabId}
      tabIndex={0}
      style={{ "--accent": accent, "--accent-ink": ink }}
    >
      <header className="detail__head">
        <span className="detail__rating">
          <strong>{starLabel(candidate.stars)}</strong>
          <span aria-hidden="true">★</span>
        </span>

        <div className="detail__naming">
          <h3 className="detail__song">
            <a href={candidate.url} target="_blank" rel="noreferrer noopener">
              {song}
            </a>
          </h3>
          <p className="detail__credits">
            {value(candidate.artist, "Unknown artist")}
            {candidate.mapper && <> · mapped by {candidate.mapper}</>}
            {candidate.difficulty_name && <> · {candidate.difficulty_name}</>}
            {tier && <> · {tier}</>}
          </p>
        </div>
      </header>

      {(candidate.mod || candidate.slot || candidate.skill) && (
        <div className="detail__tags">
          {candidate.mod && <span className="slot-badge">{candidate.mod}</span>}
          {candidate.slot && <span className="note-tag">{candidate.slot}</span>}
          {candidate.skill && <span className="skill-tag">{candidate.skill}</span>}
        </div>
      )}

      <dl className="detail__stats">
        {STATS.map(([label, abbr, key]) => (
          <div className="detail__stat" key={key}>
            <dt>
              {label}
              {abbr && <span className="detail__abbr">{abbr}</span>}
            </dt>
            <dd>{value(candidate[key])}</dd>
          </div>
        ))}
      </dl>

      {candidate.notes && <p className="detail__notes">“{candidate.notes}”</p>}

      <p className="detail__by muted">
        Shortlisted from a submission by {value(candidate.submitted_by_name, "someone")}
      </p>

      <div className="share">
        <div
          className="share__bar"
          role="progressbar"
          aria-valuenow={share}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${candidate.votes} of ${challenge.total_voters} votes`}
        >
          <div className="share__fill" style={{ width: `${share}%` }} />
        </div>
        <span className="share__label">
          <strong>{plural(candidate.votes, "vote", "votes")}</strong>
          {challenge.total_voters > 0 && <span className="muted"> · {share}% of everyone who voted</span>}
        </span>
      </div>

      <div className="detail__actions">
        {candidate.preview_url && (
          <button
            type="button"
            className="btn-small btn-preview"
            aria-pressed={playing}
            onClick={() => preview.toggle(candidate.preview_url)}
          >
            {playing ? "⏸ Stop" : "▶ Preview"}
          </button>
        )}
        {voteControl()}
      </div>

      {/* No toggle any more: one map is open at a time, so the discussion can
          just be here. It used to be collapsed because six threads stacked in a
          grid made the page enormous. */}
      <CommentThread challenge={challenge} candidate={candidate} session={session} />
    </div>
  );
}
