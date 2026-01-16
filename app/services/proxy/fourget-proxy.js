const axios = require("axios");
const { makeRequest, forwardHeaders, handleProxyRequest, handleSettingsRequest } = require("./base-proxy");
const { checkRateLimit } = require("../../utils/rate-limiter");
const { extractResults, injectSummary, rewriteUrls } = require("../../utils/html-processor");
const { isGeneralSearch, extractQuery, shouldSummarize } = require("../../ai/summary-generator");
const { log } = require("../../utils/logger");
const { getActiveTemplate } = require("../../utils/template-loader");
const config = require("../../settings");

async function handleAutocomplete(req, res) {
  try {
    const query = req.query.q || req.query.s || "";
    const targetUrl = `${config.ENGINE_URL}/api/v1/ac?s=${encodeURIComponent(query)}`;

    const response = await axios.get(targetUrl, {
      headers: {
        Cookie: req.headers.cookie || "",
      },
    });
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
      const rewrittenHTML = rewriteUrls(html);
      return res.status(response.status).send(rewrittenHTML);
    }
  } else {
    // For any HTML response, rewrite URLs to point to our proxy
    if (response.headers["content-type"]?.includes("text/html")) {
      const html = response.data.toString();
      const rewrittenHTML = rewriteUrls(html);
      return res.status(response.status).send(rewrittenHTML);
    }
    res.status(response.status).send(response.data);
  }
}

async function handleSettings(req, res) {
  return handleSettingsRequest(req, res, "settings");
}

function registerRoutes(app) {
  // Unified endpoints (must be registered before catch-all)
  app.get("/search", (req, res) => {
    // Modify URL to 4get's endpoint and query parameter
    const query = req.query.q || req.query.s;
    delete req.query.q;
    delete req.query.s;

    // Set the query parameter that 4get expects
    req.query.s = query;
    req.url = "/web?" + new URLSearchParams(req.query).toString();
    return handleProxyRequest(req, res, handleSearchRequest);
  });
  app.get("/ac", (req, res) => handleProxyRequest(req, res, handleAutocomplete));

  // Engine-specific endpoints
  app.get("/settings", (req, res) => handleProxyRequest(req, res, handleSettings));
  app.post("/settings", (req, res) => handleProxyRequest(req, res, handleSettings));

  app.get("/", (req, res) => handleProxyRequest(req, res, handleSearchRequest));

  // Handle all other requests
  app.all("*", (req, res) => handleProxyRequest(req, res, handleSearchRequest));
}

module.exports = {
  registerRoutes,
  handleSearchRequest,
  handleAutocomplete,
  handleSettings,
};
