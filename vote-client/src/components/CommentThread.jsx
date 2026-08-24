// Discussion under one map on the ballot. Top-level comments newest first,
// replies underneath in the order they were written, one level deep — replying
// to a reply joins the same group (the server re-parents it) and pre-fills an
// @mention so it's still clear who's being answered.
//
// The list is kept in local state and patched after each write instead of
// refetched: the thread sits at the bottom of a panel the reader has scrolled
// to, and pulling the whole thread back would move the ground under them.
//
// onCountChange is optional and nothing passes it now. The tally on the card
// face comes from candidate.comment_count in the ballot response instead, so a
// comment you've just posted shows here at once and reaches the card on the
// next poll. Kept because a caller that renders a count of its own — an admin
// list, say — has no other way to hear about a write.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, LOGIN_URL } from "../api.js";
import { songName } from "../difficulty.js";
import { dateTimeLabel, plural, timeAgo } from "../format.js";

// Mirrors LIMITS.commentBody in lib/validate.js. Past this the server would
// quietly truncate, so Post goes disabled and the counter turns instead.
const MAX_LENGTH = 1000;

function countVisible(list) {
  return (list || []).reduce((n, top) => n + (top.deleted ? 0 : 1) + top.replies.length, 0);
}

// First character for the fallback avatar. Array.from, not [0], so a username
// starting with an emoji or an astral character doesn't come out as half of one.
function initial(name) {
  const first = Array.from(String(name || "").trim())[0];
  return first ? first.toUpperCase() : "?";
}

function Composer({
  value,
  onChange,
  onSubmit,
  onCancel,
  submitLabel,
  busyLabel,
  placeholder,
  busy,
  autoFocus,
}) {
  const tooLong = value.length > MAX_LENGTH;
  const blank = !value.trim();
  const blocked = blank || tooLong || busy;

  function submit() {
    if (!blocked) onSubmit();
  }

  return (
    <form
      className="comment-composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <textarea
        className="comment-composer__input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={3}
        autoFocus={autoFocus}
        aria-label={placeholder}
        // Enter alone inserts a newline — people write more than one line — so
        // the send shortcut is the ⌘/Ctrl+Enter every other comment box uses.
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
      />

      <div className="comment-composer__foot">
        <span
          className={`comment-composer__count${tooLong ? " comment-composer__count--over" : ""}`}
          // Only worth announcing once it's a problem; a live character count
          // read out on every keystroke is unusable with a screen reader.
          aria-live={tooLong ? "polite" : "off"}
        >
          {value.length}/{MAX_LENGTH}
        </span>

        <div className="comment-composer__actions">
          {onCancel && (
            <button type="button" className="btn-small btn-ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
          )}
          <button type="submit" className="btn-small btn-post" disabled={blocked}>
            {busy ? busyLabel : submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}

export default function CommentThread({ challenge, candidate, session, onCountChange }) {
  const challengeId = challenge.id;
  const beatmapId = candidate.beatmap_id;

  const [comments, setComments] = useState(null); // null = still loading
  const [locked, setLocked] = useState(Boolean(challenge.voting_closed));
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState(null); // id of the group being replied to
  // Which row's Reply button was pressed. One composer serves the whole group,
  // but only the button that opened it should read "Cancel reply".
  const [replyFrom, setReplyFrom] = useState(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [replyMention, setReplyMention] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState("");
  const [confirmingId, setConfirmingId] = useState(null);
  const [busy, setBusy] = useState(null); // "new" | `reply-3` | `edit-7` | `delete-7`

  const signedIn = Boolean(session?.authenticated);
  const canModerate = Boolean(session?.is_admin);
  const canWrite = signedIn && !locked;

  // Held in a ref so `load` doesn't depend on it. A parent passing an inline
  // arrow would otherwise change the callback every render, change `load` with
  // it, and re-trigger the effect below on a loop.
  const countRef = useRef(onCountChange);
  useEffect(() => {
    countRef.current = onCountChange;
  }, [onCountChange]);

  const load = useCallback(async () => {
    try {
      const data = await api.comments(challengeId, beatmapId);
      setComments(data.comments);
      setLocked(data.locked);
      setError(null);
    } catch (err) {
      setError(err.message);
      setComments((current) => current ?? []);
    }
  }, [challengeId, beatmapId]);

  useEffect(() => {
    load();
  }, [load]);

  // A round can close while a thread is sitting open — App's poll and its
  // deadline timer both notice. Follow it one way only, so the composer goes
  // away by itself instead of failing on Post, without arguing with the
  // `locked` that came back from the fetch above.
  useEffect(() => {
    if (challenge.voting_closed) setLocked(true);
  }, [challenge.voting_closed]);

  // One place that tells the card how many comments it's showing, so the badge
  // can't drift from the list no matter which write got us here.
  useEffect(() => {
    if (comments === null) return;
    countRef.current?.(countVisible(comments));
  }, [comments]);

  function insertComment(comment) {
    setComments((current) => {
      const list = current || [];

      if (comment.parent_id === null) {
        // The server answers a double-tapped Post with the comment it already
        // stored, so drop the copy we may already be showing rather than
        // listing the same thing twice.
        const existing = list.find((top) => top.id === comment.id);
        return [
          { ...comment, replies: existing?.replies || [] },
          ...list.filter((top) => top.id !== comment.id),
        ];
      }

      return list.map((top) =>
        top.id === comment.parent_id
          ? { ...top, replies: [...top.replies.filter((reply) => reply.id !== comment.id), comment] }
          : top
      );
    });
  }

  function replaceComment(comment) {
    setComments((current) =>
      (current || []).map((top) => {
        if (top.id === comment.id) return { ...comment, replies: top.replies };
        if (!top.replies.some((reply) => reply.id === comment.id)) return top;
        return {
          ...top,
          replies: top.replies.map((reply) => (reply.id === comment.id ? comment : reply)),
        };
      })
    );
  }

  // Mirrors what the server did, so the list matches the database without a
  // refetch. `tombstoned` means the row stayed as a placeholder because there
  // are replies hanging off it.
  function dropComment(commentId, tombstoned) {
    setComments((current) =>
      (current || []).flatMap((top) => {
        if (top.id === commentId) {
          if (!tombstoned) return [];
          return [
            { ...top, deleted: true, body: null, author: null, avatar_url: null, is_mine: false },
          ];
        }

        const replies = top.replies.filter((reply) => reply.id !== commentId);
        if (replies.length === top.replies.length) return [top];
        // Removing the last reply to an already-deleted comment leaves a
        // placeholder with nothing under it. The server drops those from the
        // thread, so stop showing it here too.
        if (top.deleted && replies.length === 0) return [];
        return [{ ...top, replies }];
      })
    );
  }

  async function run(key, action) {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  const submitNew = () =>
    run("new", async () => {
      const { comment } = await api.postComment(challengeId, beatmapId, draft);
      insertComment(comment);
      setDraft("");
    });

  const submitReply = (groupId) =>
    run(`reply-${groupId}`, async () => {
      const { comment } = await api.postComment(challengeId, beatmapId, replyDraft, groupId);
      insertComment(comment);
      closeReply();
    });

  const submitEdit = (commentId) =>
    run(`edit-${commentId}`, async () => {
      const { comment } = await api.editComment(challengeId, commentId, editDraft);
      replaceComment(comment);
      setEditingId(null);
      setEditDraft("");
    });

  const submitDelete = (commentId) =>
    run(`delete-${commentId}`, async () => {
      const { outcome } = await api.deleteComment(challengeId, commentId);
      dropComment(commentId, outcome === "tombstoned");
      setConfirmingId(null);
    });

  function closeReply() {
    setReplyTo(null);
    setReplyFrom(null);
    setReplyDraft("");
    setReplyMention("");
  }

  function toggleReply(comment, isReply) {
    // Pressing the same button again closes the composer. Pressing a different
    // one in the same group re-aims it, because the group only has one.
    if (replyFrom === comment.id) {
      closeReply();
      return;
    }

    // Answering a reply lands in the same group, so name who it's aimed at.
    const mention = isReply && comment.author ? `@${comment.author} ` : "";
    setReplyTo(isReply ? comment.parent_id : comment.id);
    setReplyFrom(comment.id);
    // Only rewrite the box if there's nothing in it worth keeping — switching
    // rows shouldn't throw away a reply someone had started typing.
    if (!replyDraft.trim() || replyDraft === replyMention) {
      setReplyDraft(mention);
      setReplyMention(mention);
    }
  }

  function startEdit(comment) {
    setConfirmingId(null);
    setEditingId(comment.id);
    setEditDraft(comment.body || "");
  }

  function commentRow(comment, isReply) {
    const editing = editingId === comment.id;
    const confirming = confirmingId === comment.id;
    const replyOpen = replyFrom === comment.id;
    const deleting = busy === `delete-${comment.id}`;

    const classes = ["comment"];
    if (isReply) classes.push("comment--reply");
    if (comment.deleted) classes.push("comment--gone");

    return (
      <li className={classes.join(" ")} key={comment.id}>
        <div className="comment__avatar">
          {comment.avatar_url ? (
            <img src={comment.avatar_url} alt="" loading="lazy" />
          ) : (
            <span aria-hidden="true">{initial(comment.author)}</span>
          )}
        </div>

        <div className="comment__main">
          <p className="comment__head">
            <span className="comment__author">{comment.deleted ? "[deleted]" : comment.author}</span>
            {comment.is_mine && <span className="comment__badge">you</span>}
            <time
              className="comment__when muted"
              dateTime={comment.created_at}
              title={dateTimeLabel(comment.created_at) || undefined}
            >
              {timeAgo(comment.created_at)}
            </time>
            {comment.edited_at && <span className="comment__when muted">· edited</span>}
          </p>

          {comment.deleted && <p className="comment__body comment__body--gone">Comment deleted.</p>}

          {!comment.deleted && editing && (
            <Composer
              value={editDraft}
              onChange={setEditDraft}
              onSubmit={() => submitEdit(comment.id)}
              onCancel={() => {
                setEditingId(null);
                setEditDraft("");
              }}
              submitLabel="Save changes"
              busyLabel="Saving…"
              placeholder="Edit your comment"
              busy={busy === `edit-${comment.id}`}
              autoFocus
            />
          )}

          {!comment.deleted && !editing && <p className="comment__body">{comment.body}</p>}

          {!comment.deleted && !editing && (
            <div className="comment__actions">
              {canWrite && (
                <button
                  type="button"
                  className="comment__action"
                  aria-expanded={replyOpen}
                  onClick={() => toggleReply(comment, isReply)}
                >
                  {replyOpen ? "Cancel reply" : "Reply"}
                </button>
              )}

              {comment.is_mine && !locked && (
                <button type="button" className="comment__action" onClick={() => startEdit(comment)}>
                  Edit
                </button>
              )}

              {(comment.is_mine || canModerate) && !confirming && (
                <button
                  type="button"
                  className="comment__action comment__action--danger"
                  onClick={() => setConfirmingId(comment.id)}
                >
                  {comment.is_mine ? "Delete" : "Remove"}
                </button>
              )}

              {/* Confirming inline rather than through window.confirm: no modal
                  stealing focus out of the card, and it reads as part of the
                  thread. */}
              {confirming && (
                <span className="comment__confirm">
                  <span className="muted">Delete this?</span>
                  <button
                    type="button"
                    className="comment__action comment__action--danger"
                    disabled={deleting}
                    // The button that was just pressed unmounts to make room for
                    // this one, so without moving focus a keyboard reader would
                    // be dropped back to the top of the page.
                    autoFocus
                    onClick={() => submitDelete(comment.id)}
                  >
                    {deleting ? "Deleting…" : "Yes, delete"}
                  </button>
                  <button
                    type="button"
                    className="comment__action"
                    disabled={deleting}
                    onClick={() => setConfirmingId(null)}
                  >
                    Keep it
                  </button>
                </span>
              )}
            </div>
          )}
        </div>
      </li>
    );
  }

  const total = countVisible(comments);

  return (
    <section className="comments" aria-label={`Discussion of ${songName(candidate)}`}>
      <div className="comments__head">
        <h4 className="comments__title">
          {comments === null ? "Discussion" : plural(total, "comment", "comments")}
        </h4>
        <button
          type="button"
          className="comment__action"
          onClick={load}
          disabled={comments === null || busy !== null}
        >
          Refresh
        </button>
      </div>

      {error && (
        <p className="comments__error" role="alert">
          {error}
        </p>
      )}

      {comments === null && (
        <p className="muted" role="status">
          Loading the discussion…
        </p>
      )}

      {comments !== null && (
        <>
          {!signedIn && (
            <p className="comments__note muted">
              <a href={LOGIN_URL}>Sign in with osu!</a> to join the discussion.
            </p>
          )}

          {signedIn && locked && (
            <p className="comments__note muted">This round has closed — the thread is read-only.</p>
          )}

          {canWrite && (
            <Composer
              value={draft}
              onChange={setDraft}
              onSubmit={submitNew}
              submitLabel="Post"
              busyLabel="Posting…"
              placeholder="Make the case for this map…"
              busy={busy === "new"}
            />
          )}

          {total === 0 && (
            <p className="comments__note muted">
              {canWrite ? "Nothing here yet — say the first thing." : "No comments yet."}
            </p>
          )}

          {comments.length > 0 && (
            <ul className="comment-list">
              {comments.map((top) => (
                <li className="comment-group" key={top.id}>
                  <ul className="comment-group__list">
                    {commentRow(top, false)}
                    {top.replies.map((reply) => commentRow(reply, true))}
                  </ul>

                  {replyTo === top.id && (
                    <div className="comment-group__composer">
                      <Composer
                        value={replyDraft}
                        onChange={setReplyDraft}
                        onSubmit={() => submitReply(top.id)}
                        onCancel={closeReply}
                        submitLabel="Reply"
                        busyLabel="Posting…"
                        placeholder="Write a reply…"
                        busy={busy === `reply-${top.id}`}
                        autoFocus
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
