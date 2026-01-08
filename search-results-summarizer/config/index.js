const path = require("path");

// Environment configuration for Search Results Summarizer
module.exports = {
  // Search engine configuration
  ENGINE_NAME: process.env.ENGINE_NAME || "searxng",
  ENGINE_URL: process.env.ENGINE_URL || "http://localhost:8888",

  // OpenRouter configuration
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
  SUMMARY_ENABLED: process.env.SUMMARY_ENABLED !== "false",
  MAX_RESULTS: parseInt(process.env.MAX_RESULTS_FOR_SUMMARY) || 5,
  MAX_TOKENS: 750,

  // Rate limiting
  RATE_LIMIT_MS: 1000, // 1 second between requests

  // Server configuration
  PORT: process.env.PORT || 3000,
  HOST: process.env.HOST || "0.0.0.0",

  // Template paths
  TEMPLATES_PATH: path.join(__dirname, "../templates"),
  SEARXNG_TEMPLATE: path.join(__dirname, "../templates", "summary-template-searxng.html"),
  FOURGET_TEMPLATE: path.join(__dirname, "../templates", "summary-template-4get.html"),
};
