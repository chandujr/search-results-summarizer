const { log } = require("../utils/logger");
const config = require("../settings");

function shouldSummarize(query, results) {
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

  if (keywordCount < 3 || resultCount < 3) {
    return {
      shouldSummarize: false,
      reason: keywordCount < 3 ? `Not enough keywords (${keywordCount}/3)` : `Not enough results (${resultCount}/3)`,
    };
  }

  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/);

  const hasExcludeOverrides = queryWords.some((queryWord) =>
    excludeOverrides.some((overrideWord) => queryWord === overrideWord),
  );

  if (hasExcludeOverrides) {
    return { shouldSummarize: true };
  }

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

function isGeneralSearch(req) {
  if (config.ENGINE_NAME === "4get") {
    return req.path.startsWith("/web") || req.path === "/";
  } else if (config.ENGINE_NAME === "searxng") {
    const categories = req.query.categories;
    return !categories || categories === "general";
  }
  return false;
}

function extractQuery(req) {
  return config.ENGINE_NAME === "4get" ? req.query.s || req.body.s : req.query.q || req.body.q;
}

module.exports = {
  shouldSummarize,
  isGeneralSearch,
  extractQuery,
};
