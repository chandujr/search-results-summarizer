const axios = require("axios");
const { log } = require("../../utils/logger");
const config = require("../../config");

async function makeRequest(req) {
  const targetUrl = `${config.SEARCH_URL}${req.url}`;

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

  return axios({
    method: req.method,
    url: targetUrl,
    params: req.query,
    data: req.body,
    headers: {
      ...req.headers,
      host: new URL(config.SEARCH_URL).host,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    },
    responseType: isBinaryContent ? "arraybuffer" : "text",
    validateStatus: () => true,
    maxRedirects: 5,
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
      res.setHeader(key, value);
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
