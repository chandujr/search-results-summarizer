const config = require("../settings");
const { log } = require("./logger");

const requestCache = new Map();

requestCache.clear();

// Check if a query should be rate limited to prevent spam
function checkRateLimit(query) {
  if (!query) return false;

  const key = query.trim().toLowerCase();
  const now = Date.now();
  const lastRequest = requestCache.get(key);

  if (lastRequest && now - lastRequest < config.RATE_LIMIT_MS) {
    log(`Rate limited query: ${query}`);
    return true;
  }

  // Update the last request time for this query
  requestCache.set(key, now);

  // Clean up old entries older than 1 minute to prevent memory leaks
  const cutoff = now - 60000;
  for (const [k, v] of requestCache.entries()) {
    if (v < cutoff) {
      requestCache.delete(k);
    }
  }

  return false;
}

module.exports = {
  checkRateLimit,
};
