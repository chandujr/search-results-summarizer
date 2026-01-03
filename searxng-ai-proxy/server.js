const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const OpenAI = require("openai");
const showdown = require("showdown");
const https = require("https");
const fs = require("fs");
const path = require("path");
const app = express();

// Create a showdown converter
const converter = new showdown.Converter();

// Load and cache the HTML template
let summaryTemplate;
try {
  const templatePath = path.join(__dirname, "templates", "summary-template.html");
  summaryTemplate = fs.readFileSync(templatePath, "utf8");
  console.log("✅ Summary template loaded successfully");
} catch (error) {
  console.error("❌ Error loading summary template:", error);
  summaryTemplate = "<div>Template loading error</div>";
}

const SEARXNG_URL = process.env.SEARXNG_URL || "http://localhost:8080";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL;
const SUMMARY_ENABLED = process.env.SUMMARY_ENABLED !== "false";
const MAX_RESULTS = parseInt(process.env.MAX_RESULTS_FOR_SUMMARY) || 5;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Force IPv4 for all HTTP/HTTPS requests
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

// Streaming endpoint for AI summaries (POST request to avoid URL length limits)
app.post("/api/summary", async (req, res) => {
  console.log("📨 Summary request received");

  if (!OPENROUTER_API_KEY || !SUMMARY_ENABLED) {
    console.error("❌ Summary not enabled or API key missing");
    return res.status(400).json({ error: "Summary not enabled or API key missing" });
  }

  const { query, results } = req.body;

  if (!query || !results) {
    console.error("❌ Missing query or results");
    return res.status(400).json({ error: "Missing query or results" });
  }

  // Count keywords in the query
  const keywords = query.trim().split(/\s+/);
  const keywordCount = keywords.length;
  const resultCount = results.length;

  // Check if we have enough keywords and results to generate a summary
  if (keywordCount < 3 || resultCount < 3) {
    console.log(`⚠️ Summary skipped: ${keywordCount} keywords (need 3+), ${resultCount} results (need 3+)`);
    return res.status(200).json({
      skipped: true,
      reason: keywordCount < 3 ? `Not enough keywords (${keywordCount}/3)` : `Not enough results (${resultCount}/3)`,
    });
  }

  try {
    console.log(`🔍 Generating summary for: "${query}"`);
    const topResults = results.slice(0, MAX_RESULTS);
    const context = topResults.map((r, i) => `[${i + 1}] ${r.title}\n${r.content || r.url}`).join("\n\n");

    // Set up streaming response headers
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();

    console.log(`🤖 Calling OpenRouter with model: ${OPENROUTER_MODEL}`);

    const stream = await openrouter.chat.completions.create({
      model: OPENROUTER_MODEL,
      messages: [
        {
          role: "user",
          content: `Based on these search results for the query "${query}", provide a concise summary (2-3 paragraphs maximum) that answers the query:

${context}

Summary:`,
        },
      ],
      reasoning: {
        // One of the following (not both):
        effort: "medium", // Can be "xhigh", "high", "medium", "low", "minimal" or "none" (OpenAI-style)
        // Optional: Default is false. All models support this.
        exclude: true, // Set to true to exclude reasoning tokens from response
      },
      max_tokens: 500,
      stream: true,
    });

    console.log("✅ Stream started");
    let chunkCount = 0;

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";
      if (content) {
        chunkCount++;
        res.write(JSON.stringify({ content }) + "\n");
      }
    }

    console.log(`✅ Stream completed (${chunkCount} chunks)`);
    res.write(JSON.stringify({ done: true }) + "\n");
    res.end();
  } catch (error) {
    console.error("❌ Streaming error:", error);
    console.error("Error details:", {
      message: error.message,
      status: error.status,
      type: error.type,
      code: error.code,
    });

    if (!res.headersSent) {
      res.status(500).json({ error: error.message || "Unknown error" });
    } else {
      res.write(JSON.stringify({ error: error.message || "Unknown error" }) + "\n");
      res.end();
    }
  }
});

function injectStreamingSummary(html, query, results) {
  if (!SUMMARY_ENABLED || !results || results.length === 0) return html;

  // Count keywords in the query
  const keywords = query.trim().split(/\s+/);
  const keywordCount = keywords.length;
  const resultCount = results.length;

  // Check if we have enough keywords and results to inject summary
  if (keywordCount < 3 || resultCount < 3) {
    console.log(`⚠️ Summary injection skipped: ${keywordCount} keywords (need 3+), ${resultCount} results (need 3+)`);
    return html;
  }

  // Replace placeholders in the template with actual values
  let summaryHTML = summaryTemplate
    .replace(/{{MODEL_NAME}}/g, OPENROUTER_MODEL.split("/")[1] || "AI")
    .replace(/{{QUERY_JSON}}/g, JSON.stringify(query))
    .replace(/{{RESULTS_JSON}}/g, JSON.stringify(results));

  // Rewrite URLs to use proxy
  html = html.replace(/action=["']\/search["']/gi, 'action="/search"');
  html = html.replace(/href=["']\/search\?q=/gi, 'href="/search?q=');

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

    Object.entries(response.headers).forEach(([key, value]) => {
      if (!["transfer-encoding", "connection"].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    if (isSearchRequest && SUMMARY_ENABLED && response.headers["content-type"]?.includes("text/html")) {
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

      if (results.length > 0) {
        const enhancedHTML = injectStreamingSummary(html, query, results);
        return res.status(response.status).send(enhancedHTML);
      }
    }

    res.status(response.status).send(response.data);
  } catch (error) {
    console.error("Proxy error:", error.message);
    res.status(500).send("Proxy Error: " + error.message);
  }
});

const PORT = 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ SearXNG AI Proxy running on port ${PORT}`);
  console.log(`📍 Proxying to: ${SEARXNG_URL}`);
  console.log(`🤖 AI Model: ${OPENROUTER_MODEL}`);
  console.log(`🔍 Summary: ${SUMMARY_ENABLED ? "Enabled (Streaming)" : "Disabled"}`);
});
