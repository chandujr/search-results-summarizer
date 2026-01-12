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

app.post("/api/summary", (req, res) => {
  const { query, results } = req.body;
  const sanitizedQuery = DOMPurify.sanitize(query);
  createSummaryStream(sanitizedQuery, results, res, req);
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
