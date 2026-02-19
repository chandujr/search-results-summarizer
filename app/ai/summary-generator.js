const { log } = require("../utils/logger");
const config = require("../settings");
const { classifyQuery } = require("./query-classifier");

async function shouldSummarize(query, results) {
  const excludeWords = config.EXCLUDE_WORDS;
  const excludeOverrides = config.EXCLUDE_OVERRIDES;
  const isManualMode = config.SUMMARY_MODE === "manual";
  const isSmartMode = config.SUMMARY_MODE === "smart";

  if (isManualMode) {
    return {
      shouldSummarize: results.length > 0,
      reason: results.length === 0 ? "No search results found" : null,
    };
  }

  // In smart mode, use AI to determine if summarization is needed
  if (isSmartMode) {
    if (results.length === 0) {
      return {
        shouldSummarize: false,
        reason: "No search results found",
      };
    }

    try {
      const needsSummary = await classifyQuery(query);
      return {
        shouldSummarize: needsSummary,
        reason: needsSummary ? null : "AI determined this query doesn't need summarization",
      };
    } catch (error) {
      log(`Error in smart classification: ${error.message}`);
      return {
        shouldSummarize: false,
        reason: "Error in query classification",
      };
    }
  }

  // Original auto mode logic
  const keywords = query.trim().split(/\s+/);
  const keywordCount = keywords.length;
  const resultCount = results.length;
  const minKeywordCount = config.MIN_KEYWORD_COUNT;
  const minResultCount = config.MIN_RESULT_COUNT;

  if (keywordCount < minKeywordCount || resultCount < minResultCount) {
    return {
      shouldSummarize: false,
      reason:
        keywordCount < minKeywordCount
          ? `Not enough keywords (${keywordCount}/${minKeywordCount})`
          : `Not enough results (${resultCount}/${minResultCount})`,
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
