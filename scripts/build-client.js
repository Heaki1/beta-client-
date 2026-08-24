// Builds the React voting client (vote-client/) into public/vote/.
//
// Runs automatically on `npm install` via the postinstall hook, which is what
// makes deploys on Render work with no extra build command configured.
//
// Safe by design:
//   - if vote-client/ is missing, it warns and exits 0 instead of breaking install
//   - SKIP_CLIENT_BUILD=1 skips it entirely (handy for quick server-only installs)
//   - npm_* env vars from the parent install are stripped so the nested install
//     doesn't inherit NODE_ENV=production and skip packages
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const clientDir = path.join(__dirname, "..", "vote-client");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

if (process.env.SKIP_CLIENT_BUILD === "1") {
  console.log("⏭  SKIP_CLIENT_BUILD=1 — not building the voting client.");
  process.exit(0);
}

if (!fs.existsSync(path.join(clientDir, "package.json"))) {
  console.warn("⚠  vote-client/ not found — skipping client build. /vote will not be available.");
  process.exit(0);
}

const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (key.startsWith("npm_")) delete env[key];
}
delete env.NODE_ENV; // never let production mode strip the build tooling

function run(args) {
  console.log(`→ vote-client: npm ${args.join(" ")}`);
  // Windows needs a shell: since the CVE-2024-27980 fix Node refuses to spawn
  // npm.cmd directly. Handing a shell an args array is what triggers DEP0190,
  // so there the command goes through as a single string instead. Every
  // argument below is hardcoded, so there is no injection surface either way.
  const onWindows = process.platform === "win32";
  const options = { cwd: clientDir, stdio: "inherit", env };
  const result = onWindows
    ? spawnSync(`${npmCmd} ${args.join(" ")}`, { ...options, shell: true })
    : spawnSync(npmCmd, args, { ...options, shell: false });

  if (result.error) {
    console.error("❌ Could not run npm:", result.error.message);
    process.exit(1);
  }
  // status is null when npm was killed by a signal (e.g. out of memory on a
  // small Render instance) — treat that as a failure, not a success.
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(["install", "--no-audit", "--no-fund"]);
run(["run", "build"]);

console.log("✅ Voting client built into public/vote/");
