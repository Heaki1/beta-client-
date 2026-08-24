import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { dateTimeLabel, monthLabel, toLocalInputValue, value } from "../format.js";

const EMPTY_DRAFT = { month: "", title: "", bounty: "", closes_at: "" };

// datetime-local gives "2026-09-30T20:00" in local time; Postgres wants an
// instant, so hand it a real ISO string.
function toIso(localValue) {
  if (!localValue) return null;
  const date = new Date(localValue);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export default function AdminPanel({ onChanged, onNotice }) {
  const [rounds, setRounds] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [fields, setFields] = useState(EMPTY_DRAFT);
  const [newRound, setNewRound] = useState(EMPTY_DRAFT);
  const [beatmaps, setBeatmaps] = useState([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

  const report = useCallback((kind, text) => onNotice({ kind, text }), [onNotice]);

  const loadRounds = useCallback(async () => {
    const list = await api.adminChallenges();
    setRounds(list);
    return list;
  }, []);

  const loadDetail = useCallback(async (id) => {
    if (!id) {
      setDetail(null);
      return;
    }
    const payload = await api.adminChallenge(id);
    setDetail(payload);
    setFields({
      month: payload.month || "",
      title: payload.title || "",
      bounty: payload.bounty || "",
      closes_at: toLocalInputValue(payload.closes_at),
    });
  }, []);

  // First load: rounds + every submitted map (for building a ballot).
  useEffect(() => {
    (async () => {
      try {
        const list = await loadRounds();
        setBeatmaps(await api.beatmaps());
        const preferred = list.find((r) => r.status === "open") || list[0];
        if (preferred) setSelectedId(preferred.id);
      } catch (err) {
        report("error", err.message);
      }
    })();
  }, [loadRounds, report]);

  useEffect(() => {
    loadDetail(selectedId).catch((err) => report("error", err.message));
  }, [selectedId, loadDetail, report]);

  // Wraps every mutation: one place for the busy flag, notices and refreshes.
  // Success is reported before the refresh, so a hiccup reloading the list
  // can't make a change that actually landed look like a failure.
  const run = useCallback(
    async (action, successText, { reloadDetail = true } = {}) => {
      setBusy(true);
      try {
        const result = await action();
        if (successText) report("ok", successText);
        await loadRounds();
        // createRound opts out: it selects the round it just made, and the
        // selection effect fetches that detail. Reloading here would spend a
        // request on the round we're leaving and flash its data in the panel.
        if (reloadDetail) await loadDetail(selectedId);
        await onChanged();
        return result;
      } catch (err) {
        report("error", err.message);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [loadRounds, loadDetail, selectedId, onChanged, report]
  );

  const onBallot = useMemo(
    () => new Set((detail?.candidates || []).map((c) => c.beatmap_id)),
    [detail]
  );

  const searchResults = useMemo(() => {
    const term = search.trim().toLowerCase();
    return beatmaps
      .filter((b) => !onBallot.has(b.id))
      .filter((b) => !term || String(b.title || "").toLowerCase().includes(term))
      .slice(0, 25);
  }, [beatmaps, onBallot, search]);

  async function createRound(event) {
    event.preventDefault();
    if (!newRound.title.trim()) {
      report("error", "Give the round a title first.");
      return;
    }
    const created = await run(
      () =>
        api.createChallenge({
          month: newRound.month.trim() || null,
          title: newRound.title.trim(),
          bounty: newRound.bounty.trim() || null,
          closes_at: toIso(newRound.closes_at),
        }),
      "Round created as a draft. Add maps to the ballot, then open it.",
      { reloadDetail: false }
    );
    if (created) {
      setNewRound(EMPTY_DRAFT);
      setSelectedId(created.id);
    }
  }

  function saveFields() {
    // Sent as plain strings — "" now clears the field on the server instead of
    // being ignored, so a bounty or month can be removed once set.
    run(
      () =>
        api.updateChallenge(selectedId, {
          month: fields.month.trim(),
          title: fields.title.trim(),
          bounty: fields.bounty.trim(),
          closes_at: toIso(fields.closes_at),
        }),
      "Round details saved."
    );
  }

  function setStatus(status) {
    const text = status === "open" ? "Voting is now open." : "Round set back to draft.";
    run(() => api.updateChallenge(selectedId, { status }), text);
  }

  async function closeRound(winnerBeatmapId) {
    const result = await run(
      () => api.closeChallenge(selectedId, winnerBeatmapId),
      "Round closed and the winner is published."
    );
    if (result?.tied) {
      report(
        "error",
        "Two maps tied on votes. The first was picked — use “Declare winner” on the card you want instead."
      );
    }
  }

  return (
    <section className="admin">
      <div className="section-title">
        <h2>Manage rounds</h2>
      </div>

      <div className="admin__layout">
        <aside className="admin__list form-section">
          <h3>Rounds</h3>
          {rounds.length === 0 && <p className="muted">No rounds yet — create the first one.</p>}
          <ul className="admin__rounds">
            {rounds.map((round) => (
              <li key={round.id}>
                <button
                  type="button"
                  className={`admin__round ${round.id === selectedId ? "is-selected" : ""}`}
                  onClick={() => setSelectedId(round.id)}
                >
                  <span className="admin__round-title">{round.title}</span>
                  <span className="admin__round-meta">
                    <span className={`status-pill status-pill--${round.status}`}>{round.status}</span>
                    {monthLabel(round.month) && <span className="muted">{monthLabel(round.month)}</span>}
                  </span>
                  <span className="muted admin__round-counts">
                    {round.candidate_count} on ballot · {round.total_voters} votes
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <form className="admin__create" onSubmit={createRound}>
            <h3>New round</h3>
            <label>
              Title
              <input
                value={newRound.title}
                onChange={(e) => setNewRound({ ...newRound, title: e.target.value })}
                placeholder="September Beatmap of the Month"
              />
            </label>
            <label>
              Month
              <input
                value={newRound.month}
                onChange={(e) => setNewRound({ ...newRound, month: e.target.value })}
                placeholder="2026-09"
              />
            </label>
            <label>
              Bounty
              <input
                value={newRound.bounty}
                onChange={(e) => setNewRound({ ...newRound, bounty: e.target.value })}
                placeholder="$50 + Discord role"
              />
            </label>
            <label>
              Voting closes
              <input
                type="datetime-local"
                value={newRound.closes_at}
                onChange={(e) => setNewRound({ ...newRound, closes_at: e.target.value })}
              />
            </label>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Create draft
            </button>
          </form>
        </aside>

        <div className="admin__detail">
          {!detail && <p className="muted">Select a round to edit it.</p>}

          {detail && (
            <>
              <div className="form-section">
                <div className="admin__detail-head">
                  <h3>{detail.title}</h3>
                  <span className={`status-pill status-pill--${detail.status}`}>{detail.status}</span>
                </div>

                <div className="admin__fields">
                  <label>
                    Title
                    <input value={fields.title} onChange={(e) => setFields({ ...fields, title: e.target.value })} />
                  </label>
                  <label>
                    Month
                    <input
                      value={fields.month}
                      onChange={(e) => setFields({ ...fields, month: e.target.value })}
                      placeholder="2026-09"
                    />
                  </label>
                  <label>
                    Bounty
                    <input
                      value={fields.bounty}
                      onChange={(e) => setFields({ ...fields, bounty: e.target.value })}
                      placeholder="$50 + Discord role"
                    />
                  </label>
                  <label>
                    Voting closes
                    <input
                      type="datetime-local"
                      value={fields.closes_at}
                      onChange={(e) => setFields({ ...fields, closes_at: e.target.value })}
                    />
                  </label>
                </div>

                <div className="admin__actions">
                  <button type="button" className="btn-small btn-edit" onClick={saveFields} disabled={busy}>
                    Save details
                  </button>

                  {detail.status !== "open" && (
                    <button
                      type="button"
                      className="btn-small btn-admin"
                      onClick={() => setStatus("open")}
                      disabled={busy}
                    >
                      Open voting
                    </button>
                  )}

                  {detail.status === "open" && (
                    <button
                      type="button"
                      className="btn-small btn-delete"
                      onClick={() => closeRound(null)}
                      disabled={busy}
                    >
                      Close voting
                    </button>
                  )}

                  {detail.status === "closed" && (
                    <button
                      type="button"
                      className="btn-small btn-ghost"
                      onClick={() => setStatus("draft")}
                      disabled={busy}
                    >
                      Reopen as draft
                    </button>
                  )}
                </div>

                {detail.closes_at && (
                  <p className="muted admin__deadline">Deadline: {dateTimeLabel(detail.closes_at)}</p>
                )}
              </div>

              <div className="form-section">
                <h3>Ballot · {detail.candidates.length} maps</h3>
                {detail.candidates.length === 0 && (
                  <p className="muted">Nothing on the ballot yet. Add maps from the submissions below.</p>
                )}
                {detail.status === "closed" && (
                  <p className="muted">
                    This round is finished, so the ballot is locked — reopen it as a draft to change it.
                  </p>
                )}

                <ul className="admin__ballot">
                  {detail.candidates.map((candidate) => (
                    <li key={candidate.beatmap_id} className="admin__ballot-row">
                      <span className="admin__ballot-title">{candidate.title}</span>
                      <span className="muted">
                        ★ {value(candidate.stars)} · {value(candidate.mod, "NM")} · {candidate.votes} votes
                      </span>
                      <span className="admin__ballot-actions">
                        {detail.status === "closed" && detail.winner?.beatmap_id !== candidate.beatmap_id && (
                          <button
                            type="button"
                            className="btn-small btn-edit"
                            onClick={() => closeRound(candidate.beatmap_id)}
                            disabled={busy}
                          >
                            Declare winner
                          </button>
                        )}
                        {detail.winner?.beatmap_id === candidate.beatmap_id && (
                          <span className="skill-tag">Winner</span>
                        )}
                        {detail.status !== "closed" && (
                          <button
                            type="button"
                            className="btn-small btn-delete"
                            onClick={() =>
                              run(
                                () => api.removeCandidate(selectedId, candidate.beatmap_id),
                                "Removed from the ballot."
                              )
                            }
                            disabled={busy}
                          >
                            Remove
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {detail.status !== "closed" && (
                <div className="form-section">
                  <h3>Add from submissions</h3>
                  <input
                    className="admin__search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search submitted maps by title"
                  />
                  {searchResults.length === 0 && <p className="muted">No submissions match.</p>}
                  <ul className="admin__ballot">
                    {searchResults.map((beatmap) => (
                      <li key={beatmap.id} className="admin__ballot-row">
                        <span className="admin__ballot-title">{beatmap.title}</span>
                        <span className="muted">
                          ★ {value(beatmap.stars)} · {value(beatmap.mod, "NM")} · {value(beatmap.type)}
                        </span>
                        <button
                          type="button"
                          className="btn-small btn-admin"
                          onClick={() => run(() => api.addCandidate(selectedId, beatmap.id), "Added to the ballot.")}
                          disabled={busy}
                        >
                          Add
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
