const axios = require("axios");
const {
  makeRequest,
  forwardHeaders,
  handleProxyRequest,
  handleSettingsRequest,
  handleGenericRequest,
} = require("./base-proxy");
const { checkRateLimit } = require("../../utils/rate-limiter");
const { extractResults, injectSummary, rewriteUrls } = require("../../utils/html-processor");
const { isGeneralSearch, extractQuery, shouldSummarize } = require("../../ai/summary-generator");
const { log } = require("../../utils/logger");
const { getActiveTemplate } = require("../../utils/template-loader");
const config = require("../../settings");

function injectOpenSearchLink(html, req) {
  const headMatch = html.match(/<head[^>]*>/i);
  if (headMatch) {
    const baseUrl = config.getExternalUrl(req);
    const shortName = config.ENGINE_NAME === "4get" ? "4get Search" : "SearXNG Search";
    const opensearchLink = `<link rel="search" type="application/opensearchdescription+xml" title="${shortName}" href="${baseUrl}/opensearch.xml">`;
    return html.replace(headMatch[0], headMatch[0] + opensearchLink);
  }
  return html;
}

async function handleAutocomplete(req, res) {
  try {
    const query = req.query.q || req.query.s || "";
    const targetUrl = `${config.ENGINE_URL}/api/v1/ac?s=${encodeURIComponent(query)}`;

    // Force IPv4 for HTTPS requests to avoid potential IPv6 resolution issues
    const httpsAgent = require("https").Agent({
      family: 4,
      keepAlive: true,
    });

    const httpAgent = require("http").Agent({
      family: 4,
      keepAlive: true,
    });

    const response = await axios.get(targetUrl, {
      headers: {
        Cookie: req.headers.cookie || "",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
      httpsAgent,
      httpAgent,
      timeout: 10000,
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    const errorDetails = {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      url: `${config.ENGINE_URL}/api/v1/ac`,
    };
    log("Suggestions proxy error: " + JSON.stringify(errorDetails, null, 2));
    return res.status(500).json([]);
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
    let html = response.data.toString();

    html = injectOpenSearchLink(html, req);
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
      let html = response.data.toString();
      html = injectOpenSearchLink(html, req);
      const rewrittenHTML = rewriteUrls(html);
      return res.status(response.status).send(rewrittenHTML);
    }
    return res.status(response.status).send(response.data);
  }
}

async function handleSettings(req, res) {
  return handleSettingsRequest(req, res, "settings");
}

function registerRoutes(app) {
  function handleEndpoint(engineEndpoint) {
    return (req, res) => {
      // Modify URL to 4get's endpoint and query parameter
      const query = req.query.q || req.query.s;
      delete req.query.q;
      delete req.query.s;

      // Set the query parameter that 4get expects
      req.query.s = query;
      req.url = `/${engineEndpoint}?` + new URLSearchParams(req.query).toString();
      return handleProxyRequest(req, res, handleGenericRequest);
    };
  }

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
  app.get("/images", handleEndpoint("images"));
  app.get("/videos", handleEndpoint("videos"));
  app.get("/news", handleEndpoint("news"));
  app.get("/music", handleEndpoint("music"));

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
