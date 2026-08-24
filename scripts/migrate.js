// Runs schema.sql against the database in DATABASE_URL.
// Usage:  npm run migrate
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const db = require("../database");

(async () => {
  try {
    const file = path.join(__dirname, "..", "schema.sql");
    const sql = fs.readFileSync(file, "utf8");
    console.log("→ Applying schema.sql ...");
    await db.query(sql); // multi-statement string uses pg's simple-query protocol
    console.log("✅ Migration complete.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Migration failed:", err.message);
    process.exit(1);
  }
})();
