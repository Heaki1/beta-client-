import { LOGIN_URL } from "../api.js";

export default function LoginBar({ session, onLogout, showAdmin, onToggleAdmin }) {
  if (!session) return null;

  if (!session.authenticated) {
    return (
      <div className="loginbar">
        <span className="muted">Voting as a guest — you can browse, but not vote.</span>
        {session.login_configured ? (
          <a className="btn-osu" href={LOGIN_URL}>
            Sign in with osu!
          </a>
        ) : (
          <span className="muted">osu! sign-in isn't configured on this server yet.</span>
        )}
      </div>
    );
  }

  return (
    <div className="loginbar">
      <div className="loginbar__who">
        {session.avatar_url && <img className="loginbar__avatar" src={session.avatar_url} alt="" />}
        <div>
          <strong>{session.username}</strong>
          <span className="muted loginbar__id">osu! #{session.osu_id}</span>
        </div>
      </div>

      <div className="loginbar__actions">
        {session.is_admin && (
          <button type="button" className="btn-small btn-admin" onClick={onToggleAdmin}>
            {showAdmin ? "← Back to voting" : "⚙ Manage rounds"}
          </button>
        )}
        <button type="button" className="btn-small btn-ghost" onClick={onLogout}>
          Sign out
        </button>
      </div>
    </div>
  );
}
