const express = require("express");
const rateLimit = require("express-rate-limit");
const config = require("./settings");
const { log } = require("./utils/logger");
const { loadTemplates } = require("./utils/template-loader");
const { createSummaryStream } = require("./ai/openrouter-client");
const DOMPurify = require("isomorphic-dompurify");

const { registerRoutes: registerSearxngRoutes } = require("./services/proxy/searxng-proxy");
const { registerRoutes: registerFourgetRoutes } = require("./services/proxy/fourget-proxy");

const app = express();

if (config.TRUST_PROXY) {
  app.set("trust proxy", config.PROXY_IP_RANGE);
}

loadTemplates();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many requests, please try again later.",
    retryAfter: "15 minutes",
  },
});

app.use("/api/", (req, res, next) => {
  if (req.path.includes("/ac") || req.path === "/autocompleter") {
    return next();
  }
  return globalLimiter(req, res, next);
});

// Serve template utilities JavaScript file
app.get("/js/template-utils.js", (req, res) => {
  res.sendFile("template-utils.js", { root: "./utils/client" });
});

app.post("/api/summary", (req, res) => {
  const { query, results } = req.body;
  const sanitizedQuery = DOMPurify.sanitize(query);
  createSummaryStream(sanitizedQuery, results, res, req);
});

// Health check endpoint for cloud hosting platforms
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// OpenSearch description document endpoint
app.get("/opensearch.xml", (req, res) => {
  const baseUrl = config.getExternalUrl(req);
  const shortName = "Search Summarizer"; // config.ENGINE_NAME === "4get" ? "4get Search" : "SearXNG Search";
  const description =
    config.ENGINE_NAME === "4get" ? "Privacy-focused search with AI summaries" : "Metasearch engine with AI summaries";

  res.type("application/opensearchdescription+xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>${shortName}</ShortName>
  <Description>${description}</Description>
  <InputEncoding>UTF-8</InputEncoding>
  <Image width="16" height="16" type="image/x-icon">${baseUrl}/favicon.ico</Image>
  <Url type="text/html" method="GET" template="${baseUrl}/search?q={searchTerms}"/>
  <Url type="application/x-suggestions+json" method="GET" template="${baseUrl}/ac?q={searchTerms}"/>
</OpenSearchDescription>`);
});

if (config.ENGINE_NAME === "4get") {
  registerFourgetRoutes(app);
} else {
  registerSearxngRoutes(app);
}

app.listen(config.PORT, config.HOST, () => {
  log(`Search Results Summarizer running on port ${config.PORT}`);
  log(`Search Engine: ${config.ENGINE_NAME}`);
  log(`Proxying to: ${config.ENGINE_URL}`);
  log(`AI Model: ${config.OPENROUTER_MODEL}`);
  log(`Summary: Enabled (Streaming)`);
});
