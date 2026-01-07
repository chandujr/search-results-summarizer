const axios = require("axios");
const { makeRequest, forwardHeaders, handleProxyRequest } = require("./base-proxy");
const { checkRateLimit } = require("../../utils/rate-limiter");
const { extractResults, injectSummary } = require("../../utils/html-processor");
const { isGeneralSearch, extractQuery, shouldSummarize } = require("../../ai/summary-generator");
const { log } = require("../../utils/logger");
const { getActiveTemplate } = require("../../utils/template-loader");
const config = require("../../config");

/**
 * Handle search suggestions endpoint
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleAutocompleter(req, res) {
  try {
    const query = req.query.q || "";
    const targetUrl = `${config.SEARCH_URL}/autocompleter?q=${encodeURIComponent(query)}`;

    // Forward the request to SearXNG
    const response = await axios.get(targetUrl);
    res.status(response.status).json(response.data);
  } catch (error) {
    log("Suggestions proxy error: " + error.message);
    res.status(500).json([]);
  }
}

/**
 * Handle main search request with summary injection
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleSearchRequest(req, res) {
  const query = extractQuery(req);
  const isSearchRequest = query && query.trim().length > 0;
  const isGenSearch = isGeneralSearch(req);

  const response = await makeRequest(req);
  forwardHeaders(response, res);

  if (
    isSearchRequest &&
    config.SUMMARY_ENABLED &&
    isGenSearch &&
    response.headers["content-type"]?.includes("text/html")
  ) {
    log(`Processing HTML response for general search summary injection`);
    const html = response.data.toString();
    const results = extractResults(html);

    log(`Extracted ${results.length} results from HTML for ${config.ENGINE_NAME}`);

    // Check if we should summarize
    const summarizeResult = shouldSummarize(query, results);
    const isRateLimited = checkRateLimit(query);

    if (results.length > 0 && !isRateLimited && summarizeResult.shouldSummarize) {
      // Inject the summary only if validation passed
      const summaryTemplate = getActiveTemplate();
      const enhancedHTML = injectSummary(html, query, results, summaryTemplate);
      return res.status(response.status).send(enhancedHTML);
    } else {
      // Log why summary was not generated if there was a reason
      if (summarizeResult.reason) {
        log(`Summary not generated: ${summarizeResult.reason}`);
      }
      // Send original HTML without summary
      return res.status(response.status).send(html);
    }
  } else {
    // For non-HTML requests, send response directly
    res.status(response.status).send(response.data);
  }
}

/**
 * Handle all other requests (simple proxy)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleOtherRequests(req, res) {
  const response = await makeRequest(req);
  forwardHeaders(response, res);
  res.status(response.status).send(response.data);
}

/**
 * Register SearXNG proxy routes
 * @param {Object} app - Express app instance
 */
function registerRoutes(app) {
  // Handle search suggestions endpoint
  app.get("/autocompleter", (req, res) => handleProxyRequest(req, res, handleAutocompleter));

  // Handle main search request
  app.all("*", (req, res) => handleProxyRequest(req, res, handleSearchRequest));
}

module.exports = {
  registerRoutes,
  handleSearchRequest,
  handleOtherRequests,
};
