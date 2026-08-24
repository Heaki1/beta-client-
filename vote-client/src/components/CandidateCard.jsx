import { readableInk, songName, starColour, starGlyphs, starLabel, tierName } from "../difficulty.js";
import { value } from "../format.js";

// The six numbers a player actually compares between two maps, in osu!'s own
// shorthand. Full names ("Approach Rate") live in the detail panel, where
// there's room for them — on the card face the abbreviations are what fit, and
// they're what the game itself prints.
const STATS = [
  ["CS", "cs"],
  ["AR", "ar"],
  ["OD", "od"],
  ["HP", "hp"],
  ["BPM", "bpm"],
  ["Time", "length"],
];

// The face of one ballot card: a trading card, and nothing you can click
// inside. Every control for this map lives in the detail panel below the fan
// (CandidateDetail), because the card itself is a tab — and a button holding
// other buttons is neither operable by keyboard nor announced sensibly.
//
// The layout answers the fan: cards overlap left-to-right, so all that stays
// visible of a card behind another is its left edge. Everything that
// identifies a map — the rating, its tier, the mod, the tally — sits in that
// strip, the way a playing card puts its rank in the corner rather than the
// middle. The cover art and the credits are for the card that's been lifted.
export default function CandidateCard({
  candidate,
  challenge,
  isLeader,
  leaderLabel = "Leading",
  selected,
  focused,
  tabId,
  panelId,
  offset,
  onSelect,
}) {
  const accent = starColour(candidate.stars);
  const ink = readableInk(accent);
  const tier = tierName(candidate.stars);
  const song = songName(candidate);
  const glyphs = starGlyphs(candidate.stars);

  const picked = challenge.my_vote === candidate.beatmap_id;
  const isWinner = challenge.status === "closed" && challenge.winner?.beatmap_id === candidate.beatmap_id;
  const leading = !isWinner && !picked && isLeader && candidate.votes > 0;
  const comments = candidate.comment_count ?? 0;

  const classes = ["mapcard"];
  if (selected) classes.push("mapcard--active");
  if (picked) classes.push("mapcard--picked");
  if (isWinner) classes.push("mapcard--winner");

  // What the card is announced as. Set explicitly rather than left to the
  // contents: read aloud, the stat plate is a stream of loose numbers, and the
  // one thing a listener needs from a tab is which map it selects. The mapper
  // and the difficulty's name are in here because on a ballot they're often the
  // only things telling two entries apart — the same song, mapped twice.
  const announce = [
    song,
    candidate.artist ? `by ${candidate.artist}` : null,
    candidate.difficulty_name || null,
    candidate.mapper ? `mapped by ${candidate.mapper}` : null,
    tier ? `${starLabel(candidate.stars)} stars, ${tier}` : "unrated",
    candidate.mod ? `${candidate.mod} mod` : null,
    `${candidate.votes} ${candidate.votes === 1 ? "vote" : "votes"}`,
    comments > 0 ? `${comments} ${comments === 1 ? "comment" : "comments"}` : null,
    picked ? "your pick" : isWinner ? "winner" : leading ? leaderLabel : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <button
      type="button"
      role="tab"
      id={tabId}
      // Only the open card's panel exists in the DOM, so only the open card
      // claims to control one.
      aria-controls={selected ? panelId : undefined}
      aria-selected={selected}
      aria-label={announce}
      // Follows the keyboard cursor, not the selection: with one tab stop for
      // the whole hand, Tab has to land on the card the arrow keys left off on.
      tabIndex={focused ? 0 : -1}
      className={classes.join(" ")}
      onClick={() => onSelect(candidate.beatmap_id)}
      /* --accent drives the edge, the glow and the plate rules; --i is the
         card's signed distance from the middle of the fan, which is what the
         stylesheet turns into the card's angle. */
      style={{ "--accent": accent, "--accent-ink": ink, "--i": offset }}
    >
      <span className="mapcard__index" aria-hidden="true">
        <span className="mapcard__rating">{starLabel(candidate.stars)}</span>
        <span className="mapcard__tier">
          <span className="mapcard__glyphs">{"★".repeat(glyphs)}</span>
          {tier || "Unrated"}
        </span>
      </span>

      <span className="mapcard__art" aria-hidden="true">
        {candidate.cover_url ? (
          <img src={candidate.cover_url} alt="" loading="lazy" />
        ) : (
          <span className="mapcard__art-empty">no cover</span>
        )}
        {candidate.mod && <span className="mapcard__mod">{candidate.mod}</span>}
      </span>

      <span className="mapcard__credits" aria-hidden="true">
        <span className="mapcard__song">{song}</span>
        <span className="mapcard__artist">{value(candidate.artist, "Unknown artist")}</span>
        <span className="mapcard__mapper">
          {candidate.difficulty_name && <em>{candidate.difficulty_name}</em>}
          {candidate.mapper ? ` mapped by ${candidate.mapper}` : ""}
        </span>
      </span>

      <span className="mapcard__plate" aria-hidden="true">
        {STATS.map(([label, key]) => (
          <span className="mapcard__stat" key={key}>
            <span className="mapcard__stat-label">{label}</span>
            <span className="mapcard__stat-value">{value(candidate[key])}</span>
          </span>
        ))}
      </span>

      <span className="mapcard__foot" aria-hidden="true">
        <span className="mapcard__votes">
          <strong>{candidate.votes}</strong> {candidate.votes === 1 ? "vote" : "votes"}
          {/* Bottom-left, like the tally: it's the other thing worth knowing
              before you lift a card, and it's in the strip the fan leaves
              showing. */}
          {comments > 0 && <span className="mapcard__comments">💬 {comments}</span>}
        </span>
        {/* The state pip, not a ribbon: a ribbon in the top-right corner would
            be hidden behind the next card in the fan. */}
        {picked && <span className="mapcard__pip mapcard__pip--picked">Your pick</span>}
        {isWinner && <span className="mapcard__pip mapcard__pip--winner">Winner</span>}
        {leading && <span className="mapcard__pip mapcard__pip--leader">{leaderLabel}</span>}
      </span>
    </button>
  );
}
