const express = require("express");
const rateLimit = require("express-rate-limit");
const config = require("./config");
const { log } = require("./utils/logger");
const { loadTemplates } = require("./utils/template-loader");
const { createSummaryStream } = require("./ai/openrouter-client");

// Import proxy services
const { registerRoutes: registerSearxngRoutes } = require("./services/proxy/searxng-proxy");
const { registerRoutes: registerFourgetRoutes } = require("./services/proxy/fourget-proxy");

// Initialize Express app
const app = express();

// Initial template loading
loadTemplates();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting - prevents abuse
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many requests, please try again later.",
    retryAfter: "15 minutes",
  },
});

// Apply rate limiting to API routes except suggestions
app.use("/api/", (req, res, next) => {
  if (req.path.includes("/ac") || req.path === "/autocompleter") {
    return next();
  }
  return globalLimiter(req, res, next);
});

// API endpoint for AI summaries
app.post("/api/summary", (req, res) => {
  const { query, results } = req.body;
  createSummaryStream(query, results, res);
});

// Register search engine specific routes
if (config.ENGINE_NAME === "4get") {
  registerFourgetRoutes(app);
} else {
  registerSearxngRoutes(app);
}

// Start server
app.listen(config.PORT, config.HOST, () => {
  log(`Search Engine AI Proxy running on port ${config.PORT}`);
  log(`Proxying to: ${config.SEARCH_URL}`);
  log(`Search Engine: ${config.ENGINE_NAME}`);
  log(`AI Model: ${config.OPENROUTER_MODEL}`);
  log(`Summary: ${config.SUMMARY_ENABLED ? "Enabled (Streaming)" : "Disabled"}`);
});
