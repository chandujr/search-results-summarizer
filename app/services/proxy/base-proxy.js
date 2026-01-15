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

  // Filter out problematic headers when forwarding
  const { host, connection, "transfer-encoding": te, ...filteredHeaders } = req.headers;

  return axios({
    method: req.method,
    url: targetUrl,
    params: req.query,
    data: req.body,
    headers: {
      ...filteredHeaders,
      host: new URL(config.ENGINE_URL).host,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    },
    responseType: isBinaryContent ? "arraybuffer" : "text",
    validateStatus: (status) => status < 400 || status === 302,
    maxRedirects: 0, // Don't follow redirects automatically
    httpsAgent,
    httpAgent,
    timeout: 30000,
  });
}

function processHeaders(headers, res, req, skipLocation = false) {
  Object.entries(headers).forEach(([key, value]) => {
    // Skip location header if requested (for redirects)
    if (skipLocation && key.toLowerCase() === "location") return;

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
      } else if (key.toLowerCase() === "set-cookie") {
        const cookies = Array.isArray(value) ? value : [value];
        cookies.forEach((cookie) => {
          if (cookie) {
            let updatedCookie = cookie;

            // Replace the search engine's domain with our proxy's domain
            const engineHostname = new URL(config.ENGINE_URL).hostname;
            const externalUrl = config.getExternalUrl(req);
            const proxyHostname = new URL(externalUrl).hostname;

            const domainRegex = new RegExp(`domain=${engineHostname.replace(/\./g, "\\.")}`, "gi");
            updatedCookie = updatedCookie.replace(domainRegex, `domain=${proxyHostname}`);

            // Remove secure flag if we're not using HTTPS
            if (!externalUrl.startsWith("https://")) {
              updatedCookie = updatedCookie.replace(/; Secure/gi, "");
            }

            // Remove SameSite if it's causing issues
            updatedCookie = updatedCookie.replace(/; SameSite=(Strict|Lax)/gi, "");

            res.append(key, updatedCookie);
          }
        });
      } else {
        res.setHeader(key, value);
      }
    }
  });
}

function forwardHeaders(targetResponse, res, req) {
  // Handle redirects
  if (targetResponse.status >= 300 && targetResponse.status < 400 && targetResponse.headers.location) {
    let location = targetResponse.headers.location;

    // If the location is a relative URL, make it absolute
    if (location.startsWith("/")) {
      location = config.ENGINE_URL + location;
    }

    // If the location contains the engine URL, replace it with our proxy URL
    if (location.includes(config.ENGINE_URL)) {
      const externalUrl = config.getExternalUrl(req);
      location = location.replace(new URL(config.ENGINE_URL).origin, externalUrl);
    }

    // Process all headers except location first
    processHeaders(targetResponse.headers, res, req, true);

    // Set the location header with our proxy URL
    res.setHeader("Location", location);
    res.status(targetResponse.status).end();
    return;
  }

  // Process non-redirect responses
  processHeaders(targetResponse.headers, res, req);
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

async function handleGenericRequest(req, res) {
  const response = await makeRequest(req);
  forwardHeaders(response, res, req);
  res.status(response.status).send(response.data);
}

async function handleSettingsRequest(req, res, endpointName = "settings") {
  try {
    const response = await makeRequest(req);
    forwardHeaders(response, res, req);
    res.status(response.status).send(response.data);
  } catch (error) {
    log(`${endpointName} proxy error: ` + error.message);
    return res.status(500).send(`Error proxying ${endpointName} page`);
  }
}

module.exports = {
  makeRequest,
  forwardHeaders,
  handleProxyRequest,
  handleGenericRequest,
  handleSettingsRequest,
  processHeaders,
};
