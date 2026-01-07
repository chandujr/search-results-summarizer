const axios = require("axios");
const { makeRequest, forwardHeaders, handleProxyRequest } = require("./base-proxy");
const { checkRateLimit } = require("../../utils/rate-limiter");
const { extractResults, injectSummary } = require("../../utils/html-processor");
const { isGeneralSearch, extractQuery, shouldSummarize } = require("../../ai/summary-generator");
const { log } = require("../../utils/logger");
const { getActiveTemplate } = require("../../utils/template-loader");
const config = require("../../config");

async function handleAutocomplete(req, res) {
  try {
    const query = req.query.q || req.query.s || "";
    const targetUrl = `${config.SEARCH_URL}/api/v1/ac?s=${encodeURIComponent(query)}`;

    const response = await axios.get(targetUrl);
    res.status(response.status).json(response.data);
  } catch (error) {
    log("Suggestions proxy error: " + error.message);
    res.status(500).json([]);
  }
}

async function handleImageProxy(req, res) {
  const imageUrl = req.query.i;
  if (!imageUrl) {
    return res.status(400).send("Missing image URL parameter");
  }

  try {
    const response = await axios({
      method: "GET",
      url: `${config.SEARCH_URL}/proxy?i=${encodeURIComponent(imageUrl)}`,
      responseType: "stream",
      headers: {
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

    Object.entries(response.headers).forEach(([key, value]) => {
      if (["content-type", "cache-control", "etag", "content-length"].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    return response.data.pipe(res);
  } catch (error) {
    log("Image proxy error: " + error.message);
    return res.status(500).send("Error proxying image");
  }
}

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

    const contentType = response.headers["content-type"];
    if (contentType) {
      res.setHeader("Content-Type", contentType);
    }

    res.setHeader("Cache-Control", "public, max-age=86400");

    return res.status(response.status).send(response.data);
  } catch (error) {
    log("Favicon proxy error: " + error.message);
    return res.status(500).send("Error proxying favicon");
  }
}

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
        Object.entries(proxyRes.headers).forEach(([key, value]) => {
          if (["transfer-encoding", "connection", "content-length"].includes(key.toLowerCase())) return;

          if (key.toLowerCase() === "set-cookie") {
            (Array.isArray(value) ? value : [value]).forEach((cookie) => cookie && res.append(key, cookie));
          } else if (key.toLowerCase() === "location" && proxyRes.statusCode >= 300 && proxyRes.statusCode < 400) {
            const location = value.toString().startsWith("/")
              ? `http://localhost:3000${value}`
              : value.toString().replace("localhost:8081", "localhost:3000");
            res.setHeader(key, location);
          } else {
            res.setHeader(key, value);
          }
        });

        if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400) {
          return res.status(proxyRes.statusCode).end();
        }

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

    const summarizeResult = shouldSummarize(query, results);
    const isRateLimited = checkRateLimit(query);

    if (results.length > 0 && !isRateLimited && summarizeResult.shouldSummarize) {
      const summaryTemplate = getActiveTemplate();
      const enhancedHTML = injectSummary(html, query, results, summaryTemplate);
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

async function handleOtherRequests(req, res) {
  const response = await makeRequest(req);
  forwardHeaders(response, res);
  res.status(response.status).send(response.data);
}

function registerRoutes(app) {
  // Unified endpoints (must be registered before catch-all)
  app.get("/search", (req, res) => {
    // Modify URL to 4get's endpoint and query parameter
    const query = req.query.q;
    delete req.query.q;
    req.query.s = query;
    req.url = "/web?" + new URLSearchParams(req.query).toString();
    return handleProxyRequest(req, res, handleSearchRequest);
  });
  app.get("/ac", (req, res) => handleProxyRequest(req, res, handleAutocomplete));

  // Engine-specific endpoints
  app.get("/proxy", (req, res) => handleProxyRequest(req, res, handleImageProxy));
  app.get("/favicon", (req, res) => handleProxyRequest(req, res, handleFaviconProxy));
  app.get("/settings", (req, res) => handleProxyRequest(req, res, handleSettings));

  // Handle all other requests
  app.all("*", (req, res) => handleProxyRequest(req, res, handleSearchRequest));
}

module.exports = {
  registerRoutes,
  handleSearchRequest,
  handleOtherRequests,
  handleAutocomplete,
};
