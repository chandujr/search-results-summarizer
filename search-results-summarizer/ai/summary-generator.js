const { log } = require("../utils/logger");
const config = require("../config");

/**
 * Function to determine if a query should be summarized
 * @param {string} query - Search query
 * @param {Array} results - Array of search results
 * @returns {Object} - Object with shouldSummarize boolean and optional reason
 */
function shouldSummarize(query, results) {
  // summary will not be generated if query contains these words...
  const excludeWords = [
    "github",
    "gitlab",
    "download",
    "repository",
    "repo",
    "link",
    "url",
    "tool",
    "software",
    "program",
    "app",
    "library",
    "framework",
  ];

  // ...but summary will be generated if it also contains these words
  const excludeOverrides = [
    "what",
    "why",
    "how",
    "when",
    "where",
    "who",
    "which",
    "can",
    "will",
    "would",
    "could",
    "should",
    "is",
    "are",
    "was",
    "were",
    "do",
    "does",
    "did",
    "example",
    "explain",
    "simplify",
    "eli5",
  ];

  const keywords = query.trim().split(/\s+/);
  const keywordCount = keywords.length;
  const resultCount = results.length;

  // Check if we have enough keywords and results
  if (keywordCount < 3 || resultCount < 3) {
    return {
      shouldSummarize: false,
      reason: keywordCount < 3 ? `Not enough keywords (${keywordCount}/3)` : `Not enough results (${resultCount}/3)`,
    };
  }

  // Analyze query intent to determine if summary would be valuable
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/);

  // Check for whole word matches in exclude overrides
  const hasExcludeOverrides = queryWords.some((queryWord) =>
    excludeOverrides.some((overrideWord) => queryWord === overrideWord),
  );

  if (hasExcludeOverrides) {
    return { shouldSummarize: true };
  }

  // Check for whole word matches in exclude words
  for (const word of excludeWords) {
    if (queryWords.includes(word)) {
      return {
        shouldSummarize: false,
        reason: `Query contains word in the exclude list: "${word}"`,
      };
    }
  }

  return { shouldSummarize: true };
}

/**
 * Check if a search request is for a general search (not news, videos, etc.)
 * @param {Object} req - Express request object
 * @returns {boolean} - True if this is a general search request
 */
function isGeneralSearch(req) {
  if (config.ENGINE_NAME === "4get") {
    return req.path.startsWith("/web") || req.path === "/";
  } else if (config.ENGINE_NAME === "searxng") {
    const categories = req.query.categories;
    return !categories || categories === "general";
  }
  return false;
}

/**
 * Extract query from request based on search engine type
 * @param {Object} req - Express request object
 * @returns {string} - Extracted search query
 */
function extractQuery(req) {
  return config.ENGINE_NAME === "4get" ? req.query.s || req.body.s : req.query.q || req.body.q;
}

module.exports = {
  shouldSummarize,
  isGeneralSearch,
  extractQuery,
};
