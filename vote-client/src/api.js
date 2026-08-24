// Thin fetch wrapper. Every call sends the session cookie and turns a
// non-2xx response into an Error carrying the server's own message, so the
// UI can show "Voting has closed for this round" rather than "500".

async function request(path, { method = "GET", body } = {}) {
  const response = await fetch(path, {
    method,
    credentials: "include",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204) return null; // "no round yet"

  const raw = await response.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const error = new Error(data?.error || `Request failed (${response.status})`);
    error.status = response.status;
    // Some refusals name the rule they hit (the vote route sends
    // reason: "country"), which is steadier to branch on than the message text.
    if (data?.reason) error.reason = data.reason;
    throw error;
  }

  return data;
}

export const api = {
  // session
  me: () => request("/api/auth/me"),
  logout: () => request("/api/auth/logout", { method: "POST" }),

  // voting
  currentChallenge: () => request("/api/challenges/current"),
  castVote: (challengeId, beatmapId) =>
    request(`/api/challenges/${challengeId}/vote`, { method: "POST", body: { beatmap_id: beatmapId } }),

  // discussion on a map in the round
  comments: (challengeId, beatmapId) =>
    request(`/api/challenges/${challengeId}/candidates/${beatmapId}/comments`),
  postComment: (challengeId, beatmapId, body, parentId = null) =>
    request(`/api/challenges/${challengeId}/candidates/${beatmapId}/comments`, {
      method: "POST",
      body: { body, parent_id: parentId },
    }),
  editComment: (challengeId, commentId, body) =>
    request(`/api/challenges/${challengeId}/comments/${commentId}`, { method: "PATCH", body: { body } }),
  deleteComment: (challengeId, commentId) =>
    request(`/api/challenges/${challengeId}/comments/${commentId}`, { method: "DELETE" }),

  // submitted maps (shared with the rest of the site)
  beatmaps: () => request("/api/beatmaps/list"),

  // admin
  adminChallenges: () => request("/api/admin/challenges"),
  adminChallenge: (id) => request(`/api/admin/challenges/${id}`),
  createChallenge: (fields) => request("/api/admin/challenges", { method: "POST", body: fields }),
  updateChallenge: (id, fields) => request(`/api/admin/challenges/${id}`, { method: "PATCH", body: fields }),
  addCandidate: (id, beatmapId) =>
    request(`/api/admin/challenges/${id}/candidates`, { method: "POST", body: { beatmap_id: beatmapId } }),
  removeCandidate: (id, beatmapId) =>
    request(`/api/admin/challenges/${id}/candidates/${beatmapId}`, { method: "DELETE" }),
  closeChallenge: (id, winnerBeatmapId) =>
    request(`/api/admin/challenges/${id}/close`, {
      method: "POST",
      body: winnerBeatmapId ? { winner_beatmap_id: winnerBeatmapId } : {},
    }),
};

export const LOGIN_URL = "/api/auth/osu/login";
