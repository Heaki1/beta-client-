// Mirrors the nav on the static pages so /vote doesn't feel like a different site.
export default function SiteNav() {
  return (
    <nav>
      <a href="/">💰 Submit Bounties</a>
      <a href="/admin">📝 Mappool Suggestions</a>
      <a href="/vote" className="active" aria-current="page">
        🗳️ Vote
      </a>
    </nav>
  );
}
