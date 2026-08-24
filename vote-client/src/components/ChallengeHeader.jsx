import { useEffect, useState } from "react";
import { countdownLabel, dateTimeLabel, monthLabel, plural } from "../format.js";

function Countdown({ closesAt }) {
  const target = new Date(closesAt).getTime();
  const [now, setNow] = useState(() => Date.now());
  const remaining = target - now;
  const done = Number.isNaN(target) || remaining <= 0;

  // Once the deadline has passed there is nothing left to count, so the timer
  // stops instead of re-rendering the page once a second for the rest of the
  // session. `done` only changes once, so the interval isn't rebuilt on ticks.
  useEffect(() => {
    if (done) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [done]);

  if (Number.isNaN(target)) return null;

  return (
    <div className={`countdown ${done ? "countdown--done" : ""}`}>
      <span className="countdown__label">{done ? "Voting closed" : "Voting closes in"}</span>
      <span className="countdown__value">{countdownLabel(remaining)}</span>
      <span className="countdown__at">{dateTimeLabel(closesAt)}</span>
    </div>
  );
}

export default function ChallengeHeader({ challenge }) {
  const month = monthLabel(challenge.month);

  return (
    <header className="vote-hero">
      <div className="vote-hero__main">
        {month && <p className="vote-hero__eyebrow">Beatmap of the Month · {month}</p>}
        <h1 className="vote-hero__title">{challenge.title}</h1>

        <div className="vote-hero__meta">
          {/* Keyed off voting_closed, not status: a round whose deadline has
              passed but which the admin hasn't closed yet is still "open", and
              the pill used to say "Voting open" next to a countdown that said
              the opposite. */}
          <span className={`status-pill status-pill--${challenge.voting_closed ? "closed" : challenge.status}`}>
            {challenge.voting_closed ? "Voting closed" : "Voting open"}
          </span>
          <span className="muted">{plural(challenge.candidates.length, "map on the ballot", "maps on the ballot")}</span>
          <span className="muted">{plural(challenge.total_voters, "vote cast", "votes cast")}</span>
        </div>
      </div>

      <div className="vote-hero__side">
        {challenge.bounty && (
          <div className="bounty">
            <span className="bounty__label">Bounty</span>
            <span className="bounty__value">{challenge.bounty}</span>
          </div>
        )}
        {challenge.closes_at && <Countdown closesAt={challenge.closes_at} />}
      </div>
    </header>
  );
}
