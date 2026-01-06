const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const OpenAI = require("openai");
const https = require("https");
const fs = require("fs");
const path = require("path");
const rateLimit = require("express-rate-limit");
const app = express();

function log(message) {
  const now = new Date();
  const time = now.toTimeString().split(" ")[0];
  console.log(`[${time}] ${message}`);
}

// Simple rate limiter to prevent spam
const requestCache = new Map();
const RATE_LIMIT_MS = 1000; // 1 second between requests
const MAX_TOKENS = 750;

// Clear the request cache at startup
requestCache.clear();

// Load and cache the HTML templates based on search engine type
let activeTemplate;
let summaryTemplateSearxng;
let summaryTemplate4get;

// Load appropriate templates based on search engine
function loadTemplates() {
  try {
    // Always load both templates for flexibility
    const searxngPath = path.join(__dirname, "templates", "summary-template-searxng.html");
    const fourgetPath = path.join(__dirname, "templates", "summary-template-4get.html");

    summaryTemplateSearxng = fs.readFileSync(searxngPath, "utf8");
    summaryTemplate4get = fs.readFileSync(fourgetPath, "utf8");

    activeTemplate = ENGINE_NAME === "4get" ? summaryTemplate4get : summaryTemplateSearxng;

    log(`Summary template loaded for ${ENGINE_NAME}`);
  } catch (error) {
    console.error("Error loading summary template:", error);
    activeTemplate = "<div>Template loading error</div>";
  }
}

const SEARCH_URL = process.env.SEARCH_URL || "http://localhost:8888";
const ENGINE_NAME = process.env.ENGINE_NAME || "searxng";

// Initial template loading
loadTemplates();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL;
const SUMMARY_ENABLED = process.env.SUMMARY_ENABLED !== "false";
const MAX_RESULTS = parseInt(process.env.MAX_RESULTS_FOR_SUMMARY) || 5;

// Function to determine if a query should be summarized
function shouldSummarize(query, results) {
  // summary will not be generated if query contains these words...
  const excludeWords = [
    "github",
    "download",
    "repository",
    "link",
    "url",
    "tool",
    "software",
    "program",
    "app",
    "library",
    "framework",
  ];

  // ...but summary will be generated if it also contains these words
  const excludeOverrides = [
    "what",
    "why",
    "how",
    "when",
    "where",
    "who",
    "which",
    "can",
    "will",
    "would",
    "could",
    "should",
    "is",
    "are",
    "was",
    "were",
    "do",
    "does",
    "did",
    "example",
  ];

  const keywords = query.trim().split(/\s+/);
  const keywordCount = keywords.length;
  const resultCount = results.length;

  // Check if we have enough keywords and results
  if (keywordCount < 3 || resultCount < 3) {
    return {
      shouldSummarize: false,
      reason: keywordCount < 3 ? `Not enough keywords (${keywordCount}/3)` : `Not enough results (${resultCount}/3)`,
    };
  }

  // Analyze query intent to determine if summary would be valuable
  const queryLower = query.toLowerCase();
  const hasExcludeOverrides = excludeOverrides.some((word) => queryLower.includes(word));

  if (hasExcludeOverrides) {
    return { shouldSummarize: true };
  }

  for (const word of excludeWords) {
    if (queryLower.includes(word)) {
      return {
        shouldSummarize: false,
        reason: `Query contains word in the exclude list: "${word}"`,
      };
    }
  }

  return { shouldSummarize: true };
}

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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Force IPv4 for all HTTPS requests
const httpsAgent = new https.Agent({
  family: 4,
  keepAlive: true,
  timeout: 60000,
});

// Initialize OpenRouter client with IPv4 agent
const openrouter = new OpenAI({
  apiKey: OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "http://localhost:3000",
    "X-Title": "SearXNG AI Proxy",
  },
  httpAgent: httpsAgent,
});

function createAIPrompt(query, resultsText, dateToday) {
  return [
    {
      role: "system",
      content: `You are a general-purpose search assistant.
      Your goal is to help the user understand the topic they searched for.
      Today's date is ${dateToday}. Use this information for any date or age calculations.

      Prefer direct, useful answers.
      Use the provided sources only.
      Do not speculate or add outside knowledge.
      When appropriate, explain concepts clearly rather than summarizing opinions.

      IMPORTANT: Your response must not exceed ${MAX_TOKENS} tokens. Be concise and prioritize the most important information.`,
    },
    {
      role: "user",
      content: `QUERY:
      ${query}

      Below are search results relevant to the query.

      TASK:
      Produce a helpful search-style response similar to a modern search engine.

      IMPORTANT: Limit your response to ${MAX_TOKENS} tokens maximum.

      GUIDELINES:
      - If the query asks "what is / how does / explain", provide a clear explanation first
      - If the query is technical, prioritize accuracy, definitions, and examples
      - If the query is about current events, summarize key points and viewpoints
      - If multiple sources agree on facts, state them directly
      - If sources disagree, note the disagreement
      - Use only the information in the sources
      - Do not add hyperlinks in the summary
      - For any date-related calculations or age calculations, use today's date ${dateToday}

      SOURCES:
      ${resultsText}`,
    },
  ];
}

async function handleStreamResponse(stream, res) {
  log("Stream started");
  let chunkCount = 0;

  for await (const chunk of stream) {
    // Try different possible locations of content in the chunk
    const content = chunk.choices?.[0]?.delta?.content || chunk.choices?.[0]?.text || chunk.content || "";

    if (content) {
      chunkCount++;
      res.write(JSON.stringify({ content }) + "\n");
    }
  }

  log(`Stream completed (${chunkCount} chunks)`);
  res.write(JSON.stringify({ done: true }) + "\n");
  res.end();
}

function handleStreamError(res, error) {
  log("Streaming error: " + error.message);

  if (!res.headersSent) {
    res.status(500).json({ error: error.message || "Unknown error" });
  } else {
    res.write(JSON.stringify({ error: error.message || "Unknown error" }) + "\n");
    res.end();
  }
}

// Streaming endpoint for AI summaries (POST request to avoid URL length limits)
app.post("/api/summary", async (req, res) => {
  if (!OPENROUTER_API_KEY || !SUMMARY_ENABLED) {
    log("Summary not enabled or API key missing");
    return res.status(400).json({ error: "Summary not enabled or API key missing" });
  }

  const { query, results } = req.body;

  if (!query || !results) {
    return res.status(400).json({ error: "Missing query or results" });
  }

  const dateToday = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  try {
    const topResults = results.slice(0, MAX_RESULTS);
    const resultsText = topResults.map((r, i) => `[${i + 1}] ${r.title}\n${r.content || r.url}`).join("\n\n");

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();

    try {
      log(`Summarizing from top ${topResults.length} results`);

      const prompt = createAIPrompt(query, resultsText, dateToday);
      const stream = await openrouter.chat.completions.create({
        model: OPENROUTER_MODEL,
        messages: prompt,
        max_tokens: MAX_TOKENS,
        stream: true,
      });

      await handleStreamResponse(stream, res);
    } catch (streamError) {
      log("Stream error: " + streamError.message);
      throw streamError;
    }
  } catch (error) {
    handleStreamError(res, error);
  }
});

// Function to rewrite URLs in HTML to use the proxy
function rewriteUrls(html) {
  if (ENGINE_NAME === "4get") {
    html = html.replace(/action=["']\/web["']/gi, 'action="/web"');
    html = html.replace(/href=["']\/web\?s=/gi, 'href="/web?s=');
    html = html.replace(/src=["']\/proxy\?i=/gi, 'src="/proxy?i=');
  } else if (ENGINE_NAME === "searxng") {
    html = html.replace(/action=["']\/search["']/gi, 'action="/search"');
    html = html.replace(/href=["']\/search\?q=/gi, 'href="/search?q=');
  }
  return html;
}

function injectStreamingSummary(html, query, results) {
  if (!SUMMARY_ENABLED || !results || results.length === 0) {
    return html;
  }

  // Replace placeholders in the template with actual values
  let summaryHTML = activeTemplate
    .replace(/{{MODEL_NAME}}/g, OPENROUTER_MODEL.split("/")[1] || "AI")
    .replace(/{{QUERY_JSON}}/g, JSON.stringify(query))
    .replace(/{{RESULTS_JSON}}/g, JSON.stringify(results));

  html = rewriteUrls(html);

  // Use cheerio to find and inject summary properly based on the search engine
  const $ = cheerio.load(html);

  if (ENGINE_NAME === "4get") {
    const leftDiv = $(".left").first();
    if (leftDiv.length) {
      leftDiv.prepend(summaryHTML);
    }
  } else if (ENGINE_NAME === "searxng") {
    const urlsDiv = $("#urls").first();
    if (urlsDiv.length) {
      urlsDiv.prepend(summaryHTML);
    }
  }

  // Return the modified HTML
  return $.html();
}

// Handle 4get search suggestions endpoint
app.get("/api/v1/ac", async (req, res) => {
  try {
    const query = req.query.s || "";
    const targetUrl = `${SEARCH_URL}/api/v1/ac?s=${encodeURIComponent(query)}`;

    // Forward the request to 4get
    const response = await axios.get(targetUrl);
    res.status(response.status).json(response.data);
  } catch (error) {
    log("Suggestions proxy error: " + error.message);
    res.status(500).json([]);
  }
});

// Handle SearXNG search suggestions endpoint
app.get("/autocompleter", async (req, res) => {
  try {
    const query = req.query.q || "";
    const targetUrl = `${SEARCH_URL}/autocompleter?q=${encodeURIComponent(query)}`;

    // Forward the request to SearXNG
    const response = await axios.get(targetUrl);
    res.status(response.status).json(response.data);
  } catch (error) {
    log("Suggestions proxy error: " + error.message);
    res.status(500).json([]);
  }
});

// Handle proxy requests for images and other content (only needed for 4get)
app.get("/proxy", async (req, res) => {
  // Only handle proxy requests for 4get
  if (ENGINE_NAME !== "4get") {
    return res.status(404).send("Not found");
  }

  const imageUrl = req.query.i;
  if (!imageUrl) {
    return res.status(400).send("Missing image URL parameter");
  }

  try {
    // Instead of fetching from external URLs directly, proxy through 4get
    const response = await axios({
      method: "GET",
      url: `${SEARCH_URL}/proxy?i=${encodeURIComponent(imageUrl)}`,
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
});

// Handle favicon proxy requests (only needed for 4get)
app.get("/favicon", async (req, res) => {
  // Only handle favicon requests for 4get
  if (ENGINE_NAME !== "4get") {
    return res.status(404).send("Not found");
  }

  const faviconUrl = req.query.s;
  if (!faviconUrl) {
    return res.status(400).send("Missing favicon URL parameter");
  }

  try {
    const response = await axios({
      method: "GET",
      url: `${SEARCH_URL}/favicon?s=${encodeURIComponent(faviconUrl)}`,
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
});

app.all("*", async (req, res) => {
  try {
    const targetUrl = `${SEARCH_URL}${req.url}`;
    // Use different parameter names based on the search engine
    const query = ENGINE_NAME === "4get" ? req.query.s || req.body.s : req.query.q || req.body.q;
    const isSearchRequest = query && query.trim().length > 0;

    const response = await axios({
      method: req.method,
      url: targetUrl,
      params: req.query,
      data: req.body,
      headers: {
        ...req.headers,
        host: new URL(SEARCH_URL).host,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
      responseType: isSearchRequest ? "text" : "arraybuffer",
      validateStatus: () => true,
      maxRedirects: 5,
    });

    let isRateLimited = false;

    if (isSearchRequest && query) {
      const key = query.trim().toLowerCase();
      const now = Date.now();
      const lastRequest = requestCache.get(key);

      if (lastRequest && now - lastRequest < RATE_LIMIT_MS) {
        isRateLimited = true;
      } else {
        requestCache.set(key, now);
      }

      // Clean up old entries
      const cutoff = now - 60000; // 1 minute
      for (const [k, v] of requestCache.entries()) {
        if (v < cutoff) {
          requestCache.delete(k);
        }
      }
    }

    Object.entries(response.headers).forEach(([key, value]) => {
      if (!["transfer-encoding", "connection"].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    if (isSearchRequest && SUMMARY_ENABLED && response.headers["content-type"]?.includes("text/html")) {
      log(`Processing HTML response for summary injection`);
      const html = response.data.toString();
      const $ = cheerio.load(html);

      const results = [];

      if (ENGINE_NAME === "4get") {
        // Extract search results from 4get HTML structure
        $(".text-result").each((i, elem) => {
          const $elem = $(elem);
          const title = $elem.find(".title").first().text().trim();
          const url = $elem.find("a.hover").first().attr("href");
          const content = $elem.find(".description").first().text().trim();

          if (title && url) {
            results.push({ title, url, content });
          }
        });
      } else {
        // Extract search results from SearXNG HTML structure
        $(".result").each((i, elem) => {
          const $elem = $(elem);
          const title = $elem.find("h3 a").first().text().trim();
          const url = $elem.find("h3 a").first().attr("href");
          const content = $elem.find(".content").first().text().trim();

          if (title && url) {
            results.push({ title, url, content });
          }
        });
      }

      log(`Extracted ${results.length} results from HTML for ${ENGINE_NAME}`);
      // Check if we should summarize
      const summarizeResult = shouldSummarize(query, results);
      if (results.length > 0 && !isRateLimited && summarizeResult.shouldSummarize) {
        // Inject the summary only if validation passed
        const enhancedHTML = injectStreamingSummary(html, query, results);
        return res.status(response.status).send(enhancedHTML);
      } else {
        // Send original HTML without summary
        return res.status(response.status).send(html);
      }
    } else {
      // For non-HTML requests, send response directly
      res.status(response.status).send(response.data);
    }
  } catch (error) {
    log("Proxy error: " + error.message);
    res.status(500).send("Proxy Error: " + error.message);
  }
});

const PORT = 3000;
app.listen(PORT, "0.0.0.0", () => {
  log(`Search Engine AI Proxy running on port ${PORT}`);
  log(`Proxying to: ${SEARCH_URL}`);
  log(`Search Engine: ${ENGINE_NAME}`);
  log(`AI Model: ${OPENROUTER_MODEL}`);
  log(`Summary: ${SUMMARY_ENABLED ? "Enabled (Streaming)" : "Disabled"}`);
});
