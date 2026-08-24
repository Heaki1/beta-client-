// =====================================================================
// Profanity screening for the free-text fields players control:
// comments and display names.
//
// `bad-words` ships as ESM (its CommonJS entry point is broken upstream —
// dist/index.js requires a ./badwords.js that isn't published), so it's
// pulled in with a dynamic import instead of require(). The import is done
// once and cached.
//
// Fail-open on purpose: if the module can't be loaded, a comment gets posted
// rather than the endpoint 500ing. Set PROFANITY_FILTER=off to skip it.
// =====================================================================

let loading = null;
let filter = null;
let disabled = false;

function isEnabled() {
  return String(process.env.PROFANITY_FILTER || "").toLowerCase() !== "off";
}

async function getFilter() {
  if (filter || disabled) return filter;
  if (!loading) {
    loading = import("bad-words")
      .then((mod) => {
        const Filter = mod.Filter ?? mod.default;
        filter = new Filter();
        return filter;
      })
      .catch((err) => {
        // Once is enough — don't retry the import on every request.
        disabled = true;
        console.warn("⚠  Profanity filter unavailable, allowing text through:", err.message);
        return null;
      });
  }
  return loading;
}

// True only when we're confident the text is profane. Anything we can't
// check (filter off, module missing, empty text) is treated as clean.
async function isProfane(value) {
  if (!isEnabled()) return false;
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return false;

  const active = await getFilter();
  if (!active) return false;

  try {
    return active.isProfane(text);
  } catch {
    return false;
  }
}

// Warm the import at boot so the first comment of the day isn't the request
// that pays for it.
function warmUp() {
  if (isEnabled()) void getFilter();
}

module.exports = { isProfane, warmUp, isEnabled };
