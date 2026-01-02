const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const OpenAI = require("openai");
const showdown = require("showdown");
const https = require("https");
const app = express();

// Create a showdown converter
const converter = new showdown.Converter();

const SEARXNG_URL = process.env.SEARXNG_URL || "http://localhost:8080";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "xiaomi/mimo-v2-flash:free";
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

  const summaryHTML = `
    <div id="ai-summary-container" style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
                border-radius: 12px;
                padding: 24px;
                margin: 20px 0;
                box-shadow: 0 4px 6px rgba(0,0,0,0.4);
                border: 1px solid #334155;
                border-left: 4px solid #8b5cf6;">
      <div style="display: flex; align-items: center; margin-bottom: 12px;">
        <svg style="width: 24px; height: 24px; margin-right: 10px; fill: #8b5cf6;" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
        </svg>
        <h3 style="margin: 0; color: #f1f5f9; font-size: 18px; font-weight: 600;">AI Summary</h3>
      </div>
      <div id="ai-summary-content" style="color: #cbd5e1;
                  line-height: 1.6;
                  font-size: 15px;
                  min-height: 60px;">
        <div style="display: flex; align-items: center; gap: 8px; color: #64748b;">
          <div class="spinner" style="width: 16px; height: 16px; border: 2px solid #334155; border-top-color: #8b5cf6; border-radius: 50%; animation: spin 1s linear infinite;"></div>
          <span>Generating summary...</span>
        </div>
      </div>
      <div style="margin-top: 12px;
                  padding-top: 12px;
                  border-top: 1px solid #334155;
                  font-size: 12px;
                  color: #64748b;">
        Powered by ${OPENROUTER_MODEL.split("/")[1] || "AI"}
      </div>
    </div>
    <style>
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/showdown@2.1.0/dist/showdown.min.js"></script>
    <script>
      (function() {
        const container = document.getElementById('ai-summary-content');
        const query = ${JSON.stringify(query)};
        const results = ${JSON.stringify(results)};

        console.log('[AI Summary] Starting fetch stream');

        let summaryText = '';
        const converter = new showdown.Converter();

        fetch(window.location.origin + '/api/summary', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query, results })
        })
        .then(response => {
          if (!response.ok) {
            throw new Error('Network response was not ok');
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();

          function readStream() {
            reader.read().then(({ done, value }) => {
              if (done) {
                console.log('[AI Summary] Stream completed');
                return;
              }

              const text = decoder.decode(value, { stream: true });
              const lines = text.split('\\n').filter(line => line.trim());

              lines.forEach(line => {
                try {
                  const data = JSON.parse(line);

                  if (data.error) {
                    console.error('[AI Summary] Error:', data.error);
                    container.innerHTML = '<span style="color: #ef4444;">Failed: ' + data.error + '</span>';
                    return;
                  }

                  if (data.done) {
                    console.log('[AI Summary] Complete');
                    return;
                  }

                  if (data.content) {
                    summaryText += data.content;
                    // Convert markdown to HTML and set as innerHTML
                    container.innerHTML = converter.makeHtml(summaryText);
                  }
                } catch (e) {
                  console.error('[AI Summary] Parse error:', e);
                }
              });

              readStream();
            });
          }

          readStream();
        })
        .catch(error => {
          console.error('[AI Summary] Fetch error:', error);
          container.innerHTML = '<span style="color: #ef4444;">Connection error: ' + error.message + '</span>';
        });
      })();
    </script>`;

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
