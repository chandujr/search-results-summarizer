const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const OpenAI = require("openai");
const showdown = require("showdown");
const https = require("https");
const fs = require("fs");
const path = require("path");
const rateLimit = require("express-rate-limit");
const app = express();

function log(message) {
  const now = new Date();
  const time = now.toTimeString().split(" ")[0]; // Get HH:MM:SS part
  console.log(`[${time}] ${message}`);
}

// Simple rate limiter to prevent spam
const requestCache = new Map();
const RATE_LIMIT_MS = 1000; // 1 second between requests
const MAX_TOKENS = 750;

// Clear the request cache at startup
requestCache.clear();

// Load and cache the HTML template
let summaryTemplate;
try {
  const templatePath = path.join(__dirname, "templates", "summary-template.html");
  summaryTemplate = fs.readFileSync(templatePath, "utf8");
  log("✅ Summary template loaded successfully");
} catch (error) {
  console.error("❌ Error loading summary template:", error);
  summaryTemplate = "<div>Template loading error</div>";
}

const SEARXNG_URL = process.env.SEARXNG_URL || "http://localhost:8888";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL;
const SUMMARY_ENABLED = process.env.SUMMARY_ENABLED !== "false";
const MAX_RESULTS = parseInt(process.env.MAX_RESULTS_FOR_SUMMARY) || 5;

// Keywords that indicate a resource-finding query (less likely to need summary)
const RESOURCE_TRIGGERS = [
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

// Function to determine if a query should be summarized
function shouldSummarize(query, results) {
  // Count keywords in the query
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

  for (const word of RESOURCE_TRIGGERS) {
    if (queryLower.includes(word)) {
      return {
        shouldSummarize: false,
        reason: `Query appears to be resource-finding: "${word}"`,
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

// Apply rate limiting to all API routes
app.use("/api/", globalLimiter);

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
  log("✅ Stream started");
  let chunkCount = 0;

  for await (const chunk of stream) {
    // Try different possible locations of content in the chunk
    const content = chunk.choices?.[0]?.delta?.content || chunk.choices?.[0]?.text || chunk.content || "";

    if (content) {
      chunkCount++;
      res.write(JSON.stringify({ content }) + "\n");
    }
  }

  log(`✅ Stream completed (${chunkCount} chunks)`);
  res.write(JSON.stringify({ done: true }) + "\n");
  res.end();
}

function handleStreamError(res, error) {
  log("❌ Streaming error: " + error.message);

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
    log("❌ Summary not enabled or API key missing");
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
      const prompt = createAIPrompt(query, resultsText, dateToday);
      const stream = await openrouter.chat.completions.create({
        model: OPENROUTER_MODEL,
        messages: prompt,
        max_tokens: MAX_TOKENS,
        stream: true,
      });

      await handleStreamResponse(stream, res);
    } catch (streamError) {
      log("❌ Stream error: " + streamError.message);
      throw streamError;
    }
  } catch (error) {
    handleStreamError(res, error);
  }
});

// Function to rewrite URLs in HTML to use the proxy
function rewriteUrls(html) {
  html = html.replace(/action=["']\/search["']/gi, 'action="/search"');
  html = html.replace(/href=["']\/search\?q=/gi, 'href="/search?q=');
  return html;
}

function injectStreamingSummary(html, query, results) {
  if (!SUMMARY_ENABLED || !results || results.length === 0) {
    return html;
  }

  // Replace placeholders in the template with actual values
  let summaryHTML = summaryTemplate
    .replace(/{{MODEL_NAME}}/g, OPENROUTER_MODEL.split("/")[1] || "AI")
    .replace(/{{QUERY_JSON}}/g, JSON.stringify(query))
    .replace(/{{RESULTS_JSON}}/g, JSON.stringify(results));

  html = rewriteUrls(html);

  const resultsMarker = /<div[^>]*id=["']results["'][^>]*>/i;
  if (resultsMarker.test(html)) {
    return html.replace(resultsMarker, (match) => match + summaryHTML);
  }

  const mainMarker = /<main[^>]*>/i;
  if (mainMarker.test(html)) {
    return html.replace(mainMarker, (match) => match + summaryHTML);
  }
  return summaryHTML + html;
}

app.all("*", async (req, res) => {
  try {
    const targetUrl = `${SEARXNG_URL}${req.url}`;
    const query = req.query.q || req.body.q;
    const isSearchRequest = query && query.trim().length > 0;

    const response = await axios({
      method: req.method,
      url: targetUrl,
      params: req.query,
      data: req.body,
      headers: {
        ...req.headers,
        host: new URL(SEARXNG_URL).host,
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
      log(`🔍 Processing HTML response for summary injection`);
      const html = response.data.toString();
      const $ = cheerio.load(html);

      // Extract search results from SearXNG HTML structure
      const results = [];
      $("article.result").each((i, elem) => {
        const $elem = $(elem);
        const title = $elem.find("h3 a").first().text().trim();
        const url = $elem.find("h3 a").first().attr("href");
        const content = $elem.find("p.content").first().text().trim();

        if (title && url) {
          results.push({ title, url, content });
        }
      });

      log(`🔍 Extracted ${results.length} results from HTML`);
      // Check if we should summarize
      const summarizeResult = shouldSummarize(query, results);
      if (results.length > 0 && !isRateLimited && summarizeResult.shouldSummarize) {
        // Inject the summary only if validation passed
        const enhancedHTML = injectStreamingSummary(html, query, results);
        return res.status(response.status).send(enhancedHTML);
      }
    }

    res.status(response.status).send(response.data);
  } catch (error) {
    log("❌ Proxy error: " + error.message);
    res.status(500).send("Proxy Error: " + error.message);
  }
});

const PORT = 3000;
app.listen(PORT, "0.0.0.0", () => {
  log(`✅ SearXNG AI Proxy running on port ${PORT}`);
  log(`📍 Proxying to: ${SEARXNG_URL}`);
  log(`🤖 AI Model: ${OPENROUTER_MODEL}`);
  log(`🔍 Summary: ${SUMMARY_ENABLED ? "Enabled (Streaming)" : "Disabled"}`);
});
