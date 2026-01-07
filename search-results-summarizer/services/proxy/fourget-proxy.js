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
    const query = req.query.s || "";
    const targetUrl = `${config.SEARCH_URL}/api/v1/ac?s=${encodeURIComponent(query)}`;

    // Forward the request to 4get
    const response = await axios.get(targetUrl);
    res.status(response.status).json(response.data);
  } catch (error) {
    log("Suggestions proxy error: " + error.message);
    res.status(500).json([]);
  }
}

/**
 * Handle image proxy requests
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleImageProxy(req, res) {
  const imageUrl = req.query.i;
  if (!imageUrl) {
    return res.status(400).send("Missing image URL parameter");
  }

  try {
    // Instead of fetching from external URLs directly, proxy through 4get
    const response = await axios({
      method: "GET",
      url: `${config.SEARCH_URL}/proxy?i=${encodeURIComponent(imageUrl)}`,
      responseType: "stream",
      headers: {
        // Forward browser headers to 4get
        "User-Agent":
          req.headers["user-agent"] ||
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        Accept: req.headers["accept"] || "image/*",
        "Accept-Encoding": req.headers["accept-encoding"],
      },
      validateStatus: () => true,
      maxRedirects: 5,
      timeout: 15000,
    });

    // Forward headers from 4get's response
    Object.entries(response.headers).forEach(([key, value]) => {
      if (["content-type", "cache-control", "etag", "content-length"].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    // Pipe the response directly from 4get
    return response.data.pipe(res);
  } catch (error) {
    log("Image proxy error: " + error.message);
    return res.status(500).send("Error proxying image");
  }
}

/**
 * Handle favicon proxy requests
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleFaviconProxy(req, res) {
  const faviconUrl = req.query.s;
  if (!faviconUrl) {
    return res.status(400).send("Missing favicon URL parameter");
  }

  try {
    const response = await axios({
      method: "GET",
      url: `${config.SEARCH_URL}/favicon?s=${encodeURIComponent(faviconUrl)}`,
      responseType: "arraybuffer",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        Accept: req.headers["accept"] || "image/*",
      },
      validateStatus: () => true,
      maxRedirects: 5,
      timeout: 10000,
    });

    // Forward the favicon content type if available
    const contentType = response.headers["content-type"];
    if (contentType) {
      res.setHeader("Content-Type", contentType);
    }

    // Set cache control headers for favicons
    res.setHeader("Cache-Control", "public, max-age=86400"); // Cache for 1 day

    return res.status(response.status).send(response.data);
  } catch (error) {
    log("Favicon proxy error: " + error.message);
    return res.status(500).send("Error proxying favicon");
  }
}

/**
 * Handle settings endpoint to ensure cookies are properly set
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleSettings(req, res) {
  try {
    const queryString = req.url.includes("?") ? req.url.substring(req.url.indexOf("?")) : "";
    const targetUrl = `${config.SEARCH_URL}/settings${queryString}`;

    const parsedUrl = new URL(targetUrl);
    const httpModule = parsedUrl.protocol === "https:" ? require("https") : require("http");

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: "GET",
      headers: {
        "User-Agent": req.headers["user-agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: req.headers["accept"] || "text/html,application/xhtml+xml",
      },
    };

    return new Promise((resolve, reject) => {
      const proxyReq = httpModule.request(options, (proxyRes) => {
        // Copy headers, with special handling for Set-Cookie and Location
        Object.entries(proxyRes.headers).forEach(([key, value]) => {
          if (["transfer-encoding", "connection", "content-length"].includes(key.toLowerCase())) return;

          if (key.toLowerCase() === "set-cookie") {
            (Array.isArray(value) ? value : [value]).forEach((cookie) => cookie && res.append(key, cookie));
          } else if (key.toLowerCase() === "location" && proxyRes.statusCode >= 300 && proxyRes.statusCode < 400) {
            // Update redirect location to point to our proxy
            const location = value.toString().startsWith("/")
              ? `http://localhost:3000${value}`
              : value.toString().replace("localhost:8081", "localhost:3000");
            res.setHeader(key, location);
          } else {
            res.setHeader(key, value);
          }
        });

        // For redirects, send empty response
        if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400) {
          return res.status(proxyRes.statusCode).end();
        }

        // Otherwise pipe the response
        res.status(proxyRes.statusCode);
        proxyRes.pipe(res).on("end", resolve);
      });

      proxyReq.on("error", (error) => {
        log("Settings proxy error: " + error.message);
        res.status(500).send("Error proxying settings page");
        reject(error);
      });

      proxyReq.end();
    });
  } catch (error) {
    log("Settings proxy error: " + error.message);
    return res.status(500).send("Error proxying settings page");
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
 * Register 4get proxy routes
 * @param {Object} app - Express app instance
 */
function registerRoutes(app) {
  // Handle search suggestions endpoint
  app.get("/api/v1/ac", (req, res) => handleProxyRequest(req, res, handleAutocompleter));

  // Handle image proxy
  app.get("/proxy", (req, res) => handleProxyRequest(req, res, handleImageProxy));

  // Handle favicon proxy
  app.get("/favicon", (req, res) => handleProxyRequest(req, res, handleFaviconProxy));

  // Handle settings endpoint
  app.get("/settings", (req, res) => handleProxyRequest(req, res, handleSettings));

  // Handle main search request
  app.all("*", (req, res) => handleProxyRequest(req, res, handleSearchRequest));
}

module.exports = {
  registerRoutes,
  handleSearchRequest,
  handleOtherRequests,
};
