import { plural } from "../format.js";

export default function WinnerBanner({ challenge }) {
  const { winner, bounty, total_voters: totalVoters } = challenge;

  if (!winner) {
    return (
      <section className="winner winner--none">
        <h2>This round closed without a winner</h2>
        <p className="muted">No votes were cast before the deadline.</p>
      </section>
    );
  }

  return (
    <section className="winner">
      {winner.cover_url && <img className="winner__cover" src={winner.cover_url} alt="" />}
      <div className="winner__body">
        <p className="winner__eyebrow">Winner · Beatmap of the Month</p>
        <h2 className="winner__title">
          <a href={winner.url} target="_blank" rel="noreferrer noopener">
            {winner.title}
          </a>
        </h2>
        <p className="winner__meta">
          {plural(winner.votes, "vote", "votes")} of {totalVoters} cast
          {bounty ? ` · bounty: ${bounty}` : ""}
        </p>
      </div>
    </section>
  );
}
