const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

// Managed Postgres (Render, Heroku, Supabase, Neon…) requires TLS but presents
// a certificate signed by its own internal CA, hence rejectUnauthorized:false.
// A local Postgres usually has TLS switched off entirely, and asking for it
// fails the connection outright — so the decision is made from the URL itself.
//
// NODE_ENV is deliberately not consulted: developing locally against a hosted
// database is the normal setup here, and that connection still needs TLS.
// PGSSL=disable / PGSSL=require overrides everything below.
function sslConfig() {
  const override = String(process.env.PGSSL || "").toLowerCase();
  if (override === "disable" || override === "off" || override === "false") return false;
  if (override === "require" || override === "on" || override === "true") {
    return { rejectUnauthorized: false };
  }

  let url;
  try {
    url = new URL(process.env.DATABASE_URL);
  } catch {
    // Not a URL we can parse (a socket path, say) — assume it's local.
    return false;
  }

  // A connection string that states what it wants is taken at its word.
  const sslmode = String(url.searchParams.get("sslmode") || "").toLowerCase();
  if (sslmode === "disable") return false;
  if (sslmode) return { rejectUnauthorized: false };

  const host = url.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "";
  return isLocal ? false : { rejectUnauthorized: false };
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig(),
  // A pooled connection dropped by the server (Render recycles them) surfaces
  // as an error on an idle client; without these the first query afterwards
  // hangs until the default OS timeout.
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});

// An idle client erroring out is not fatal — pg discards it and opens a new
// one on the next query. Without a listener, though, it's an unhandled 'error'
// event, which takes the whole process down.
pool.on("error", (err) => {
  console.error("Postgres idle client error:", err.message);
});

module.exports = pool;
