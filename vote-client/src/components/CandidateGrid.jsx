import { useEffect, useMemo, useRef, useState } from "react";
import { starValue } from "../difficulty.js";
import CandidateCard from "./CandidateCard.jsx";
import CandidateDetail from "./CandidateDetail.jsx";

// How far apart the cards sit. The fan has to hold anything from two maps to a
// dozen, so the geometry is derived from how many there are rather than fixed:
// a small hand splays generously and a big one tightens up.
//
// The one hard rule is that the hand must never be wider than HAND_WIDTH.
// Because the fan is centred, an overflowing hand would push its left-hand
// cards to negative coordinates, where no scrollbar can reach them — so the
// overlap has no lower bound and a very long ballot simply stacks tighter.
// Below HAND_WIDTH's worth of room the layout stops being a fan at all and
// becomes a scroll-snapping rail; see the media query in styles.css.
const CARD_WIDTH = 250; // keep in step with --card-w in styles.css
const HAND_WIDTH = 900;
const MAX_TILT = 7; // degrees per card away from the middle
const MAX_SPREAD = 34; // degrees across the whole hand
const MAX_VISIBLE = 180; // px of a covered card showing, at a small hand

function fanGeometry(count) {
  const gaps = Math.max(1, count - 1);
  return {
    "--fan-step": `${Math.min(MAX_TILT, MAX_SPREAD / gaps)}deg`,
    "--fan-lap": `${Math.round(Math.min(MAX_VISIBLE, (HAND_WIDTH - CARD_WIDTH) / gaps))}px`,
  };
}

// Left to right, easiest to hardest. Three reasons to re-sort rather than take
// the API's order, which is by vote tally: cards would swap places under the
// cursor every time the 30-second poll landed, moving a focused node in the DOM
// blurs it, and the accent colour already runs along the fan as a difficulty
// gradient — so it may as well run in order. Who's leading is said by the pip
// on each card, which is a better place for it than the order.
function byDifficulty(candidates) {
  return [...candidates].sort((a, b) => {
    // Unrated last: it isn't a difficulty of zero, it's an unknown.
    const left = starValue(a.stars) ?? Infinity;
    const right = starValue(b.stars) ?? Infinity;
    if (left !== right) return left - right;
    // Ties, and two unrated maps (Infinity - Infinity is NaN, so never subtract
    // these), broken on the id so the order is at least deterministic.
    return String(a.beatmap_id).localeCompare(String(b.beatmap_id));
  });
}

export default function CandidateGrid({ challenge, session, votingFor, onVote, preview }) {
  const candidates = useMemo(() => byDifficulty(challenge.candidates), [challenge.candidates]);

  // Two separate positions, which is what the tabs pattern asks for when
  // opening a panel costs something: `selectedId` is the card the panel is
  // showing, `cursorId` is the card the keyboard is on. Arrow keys move the
  // cursor only — Enter or Space opens it. Otherwise holding an arrow key would
  // fire a comment fetch per card and throw away anything half-typed on the way
  // past.
  //
  // Both are beatmap ids rather than indexes, so that a map being added to or
  // removed from the ballot mid-session can't quietly repoint them.
  const [selectedId, setSelectedId] = useState(null);
  const [cursorId, setCursorId] = useState(null);
  const listRef = useRef(null);

  const selected = candidates.find((c) => c.beatmap_id === selectedId) ?? candidates[0];
  const cursorAt = candidates.findIndex((c) => c.beatmap_id === cursorId);
  const focusIndex = cursorAt >= 0 ? cursorAt : Math.max(0, candidates.indexOf(selected));

  // Commits the opening default to state on the first render that has a ballot
  // to open. Leaving `selectedId` null and falling back to candidates[0] on
  // every render would work right up until the ballot changed shape underneath
  // it, at which point the panel would swap maps on its own and take a
  // half-written comment with it.
  useEffect(() => {
    if (selectedId === null && candidates.length > 0) setSelectedId(candidates[0].beatmap_id);
  }, [selectedId, candidates]);

  function moveCursor(index) {
    setCursorId(candidates[index].beatmap_id);
    // Moved imperatively rather than through an effect. The card is already in
    // the DOM, focus doesn't depend on the tabIndex that's about to change, and
    // doing it here means there's no "focus the cursor next render" flag left
    // armed to fire on an unrelated render — a poll landing, say — and pull
    // focus out of the comment box.
    listRef.current?.querySelectorAll('[role="tab"]')[index]?.focus();
  }

  function onKeyDown(event) {
    const last = candidates.length - 1;
    let next;

    // Left and right only. The tablist is horizontal, so up and down belong to
    // the page — a keyboard user standing on a card has to be able to scroll
    // down to the panel, which is the longest thing on the page.
    switch (event.key) {
      case "ArrowRight":
        next = focusIndex >= last ? 0 : focusIndex + 1;
        break;
      case "ArrowLeft":
        next = focusIndex <= 0 ? last : focusIndex - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      default:
        // Enter and Space fall through to the button's own behaviour, which is
        // what activates the tab. Nothing to add here.
        return;
    }

    event.preventDefault();
    moveCursor(next);
  }

  function select(beatmapId) {
    // A clip belongs to the card that started it, and that card's stop button
    // is about to be replaced by another map's. Leaving it playing would strand
    // audio with nothing on the page able to stop it.
    if (beatmapId !== selectedId) preview.stop();
    setSelectedId(beatmapId);
    setCursorId(beatmapId);
  }

  if (candidates.length === 0) {
    return (
      <section className="empty-state">
        <h2>The ballot is empty</h2>
        <p>No maps have been shortlisted for this round yet. Check back shortly.</p>
      </section>
    );
  }

  // Not candidates[0].votes any more — the hand is in difficulty order, so the
  // leader has to be found rather than read off the front.
  const topVotes = Math.max(0, ...candidates.map((c) => c.votes));
  // Several maps can share the top tally; calling all of them "Leading" reads
  // like a bug, so say what's actually happening.
  const leaders = candidates.filter((c) => c.votes === topVotes).length;
  const leaderLabel = leaders > 1 ? "Tied for the lead" : "Leading";

  return (
    <section className="ballot">
      <div className="section-title">
        <h2>{challenge.voting_closed ? "Final tally" : "Pick one map"}</h2>
      </div>

      {/* can_vote is part of the condition because otherwise this promises a
          vote to someone the ballot has just told they don't get one. */}
      {!challenge.voting_closed &&
        session?.authenticated &&
        session.can_vote !== false &&
        !challenge.my_vote && (
          <p className="ballot__hint">
            You have one vote. Spend it on the map you want to play next month — you can move it later.
          </p>
        )}

      <div
        className="fan"
        role="tablist"
        aria-label="Maps on the ballot, easiest first"
        aria-orientation="horizontal"
        ref={listRef}
        onKeyDown={onKeyDown}
        style={fanGeometry(candidates.length)}
      >
        {candidates.map((candidate, i) => (
          <CandidateCard
            key={candidate.beatmap_id}
            candidate={candidate}
            challenge={challenge}
            isLeader={candidate.votes === topVotes}
            leaderLabel={leaderLabel}
            selected={candidate.beatmap_id === selected.beatmap_id}
            focused={i === focusIndex}
            tabId={`maptab-${candidate.beatmap_id}`}
            panelId={`mappanel-${candidate.beatmap_id}`}
            // Signed distance from the middle of the hand: -1.5 .. 1.5 for four
            // cards. The stylesheet turns it into the card's angle.
            offset={i - (candidates.length - 1) / 2}
            onSelect={select}
          />
        ))}
      </div>

      {/* Remounted per map on purpose: it resets the composer, so a half-written
          comment can't follow you to another map's thread. */}
      <CandidateDetail
        key={selected.beatmap_id}
        candidate={selected}
        challenge={challenge}
        session={session}
        isBusy={votingFor === selected.beatmap_id}
        onVote={onVote}
        preview={preview}
        panelId={`mappanel-${selected.beatmap_id}`}
        tabId={`maptab-${selected.beatmap_id}`}
      />
    </section>
  );
}
