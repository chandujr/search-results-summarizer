const axios = require("axios");
const { makeRequest, forwardHeaders, handleProxyRequest, handleSettingsRequest } = require("./base-proxy");
const { checkRateLimit } = require("../../utils/rate-limiter");
const { extractResults, injectSummary } = require("../../utils/html-processor");
const { isGeneralSearch, extractQuery, shouldSummarize } = require("../../ai/summary-generator");
const { log } = require("../../utils/logger");
const { getActiveTemplate } = require("../../utils/template-loader");
const config = require("../../settings");

async function handleAutocomplete(req, res) {
  try {
    const query = req.query.q || "";
    const targetUrl = `${config.ENGINE_URL}/autocompleter?q=${encodeURIComponent(query)}`;

    const response = await axios.get(targetUrl);
    res.status(response.status).json(response.data);
  } catch (error) {
    log("Suggestions proxy error: " + error.message);
    res.status(500).json([]);
  }
}

async function handleSearchRequest(req, res) {
  const query = extractQuery(req);
  const isSearchRequest = query && query.trim().length > 0;
  const isGenSearch = isGeneralSearch(req);

  const response = await makeRequest(req);
  forwardHeaders(response, res, req);

  if (isSearchRequest && isGenSearch && response.headers["content-type"]?.includes("text/html")) {
    log(`Processing HTML response for general search summary injection`);
    const html = response.data.toString();
    const results = extractResults(html);

    log(`Extracted ${results.length} results from HTML for ${config.ENGINE_NAME}`);

    const summarizeResult = shouldSummarize(query, results);
    const isRateLimited = checkRateLimit(query);

    const isManualMode = config.SUMMARY_MODE === "manual";

    if (!isRateLimited && summarizeResult.shouldSummarize) {
      const summaryTemplate = getActiveTemplate();
      const enhancedHTML = injectSummary(html, query, results, summaryTemplate, isManualMode);
      return res.status(response.status).send(enhancedHTML);
    } else {
      if (summarizeResult.reason) {
        log(`Summary not generated: ${summarizeResult.reason}`);
      }
      return res.status(response.status).send(html);
    }
  } else {
    res.status(response.status).send(response.data);
  }
}

async function handlePreferences(req, res) {
  return handleSettingsRequest(req, res, "preferences");
}

function registerRoutes(app) {
  // Unified endpoints (must be registered before catch-all)
  app.get("/search", (req, res) => handleProxyRequest(req, res, handleSearchRequest));
  app.get("/ac", (req, res) => handleProxyRequest(req, res, handleAutocomplete));

  // Handle preferences
  app.get("/preferences", (req, res) => handleProxyRequest(req, res, handlePreferences));
  app.post("/preferences", (req, res) => handleProxyRequest(req, res, handlePreferences));

  // Handle all other requests
  app.all("*", (req, res) => handleProxyRequest(req, res, handleSearchRequest));
}

module.exports = {
  registerRoutes,
  handleSearchRequest,
  handleAutocomplete,
  handlePreferences,
};
