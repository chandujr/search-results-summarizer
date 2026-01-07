const axios = require("axios");
const { log } = require("../../utils/logger");
const config = require("../../config");

/**
 * Make a request to the target search engine
 * @param {Object} req - Express request object
 * @returns {Object} - Response from the target server
 */
async function makeRequest(req) {
  const targetUrl = `${config.SEARCH_URL}${req.url}`;

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
    responseType: "text",
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

/**
 * Handle proxy requests with error handling
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} handler - Custom handler function
 */
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
