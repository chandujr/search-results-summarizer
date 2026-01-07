const config = require("../config");
const { log } = require("./logger");

// Simple rate limiter to prevent spam
const requestCache = new Map();

// Clear the request cache at startup
requestCache.clear();

/**
 * Check if a query should be rate limited
 * @param {string} query - Search query
 * @returns {boolean} - True if rate limited, false otherwise
 */
function checkRateLimit(query) {
  if (!query) return false;

  const key = query.trim().toLowerCase();
  const now = Date.now();
  const lastRequest = requestCache.get(key);

  if (lastRequest && now - lastRequest < config.RATE_LIMIT_MS) {
    log(`Rate limited query: ${query}`);
    return true;
  }

  // Update the last request time
  requestCache.set(key, now);

  // Clean up old entries
  const cutoff = now - 60000; // 1 minute
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
