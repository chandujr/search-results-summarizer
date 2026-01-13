const axios = require("axios");
const { log } = require("../../utils/logger");
const config = require("../../settings");

async function makeRequest(req) {
  const targetUrl = `${config.ENGINE_URL}${req.url}`;

  // Determine if this is a request for binary content (images, favicons, etc.)
  const isBinaryContent =
    req.url.includes("/favicon") ||
    req.url.includes("/banner/") ||
    req.url.includes("/proxy") ||
    req.headers.accept?.includes("image/") ||
    req.path?.endsWith(".ico") ||
    req.path?.endsWith(".png") ||
    req.path?.endsWith(".jpg") ||
    req.path?.endsWith(".jpeg") ||
    req.path?.endsWith(".gif") ||
    req.path?.endsWith(".svg");

  // Force IPv4 for HTTPS requests to avoid potential IPv6 resolution issues
  const httpsAgent = require("https").Agent({
    family: 4,
    keepAlive: true,
  });

  const httpAgent = require("http").Agent({
    family: 4,
    keepAlive: true,
  });

  return axios({
    method: req.method,
    url: targetUrl,
    params: req.query,
    data: req.body,
    headers: {
      ...req.headers,
      host: new URL(config.ENGINE_URL).host,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    },
    responseType: isBinaryContent ? "arraybuffer" : "text",
    validateStatus: () => true,
    maxRedirects: 5,
    httpsAgent,
    httpAgent,
    timeout: 30000,
  });
}

/**
 * Forward response headers from target response to client response
 * @param {Object} targetResponse - Response from target server
 * @param {Object} res - Express response object
 */
function forwardHeaders(targetResponse, res) {
  Object.entries(targetResponse.headers).forEach(([key, value]) => {
    if (!["transfer-encoding", "connection"].includes(key.toLowerCase())) {
      if (key.toLowerCase() === "content-security-policy" && config.MODIFY_CSP_HEADERS === true) {
        const originalCSP = value;
        let modifiedCSP = value;

        modifiedCSP = modifiedCSP.replace(
          /script-src[^;]*/g,
          "script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'",
        );
        modifiedCSP = modifiedCSP.replace(/connect-src 'self'/g, "connect-src 'self' https://cdn.jsdelivr.net");
        modifiedCSP = modifiedCSP.replace(/style-src 'self'/g, "style-src 'self' 'unsafe-inline'");

        log(`[CSP Modified] Original: ${originalCSP.substring(0, 200)}...`);
        log(`[CSP Modified] Modified: ${modifiedCSP.substring(0, 200)}...`);

        res.setHeader(key, modifiedCSP);
      } else {
        res.setHeader(key, value);
      }
    }
  });
}

async function handleProxyRequest(req, res, handler) {
  try {
    await handler(req, res);
  } catch (error) {
    log("Proxy error: " + error.message);
    if (!res.headersSent) {
      res.status(500).send("Proxy Error: " + error.message);
    }
  }
}

module.exports = {
  makeRequest,
  forwardHeaders,
  handleProxyRequest,
};
