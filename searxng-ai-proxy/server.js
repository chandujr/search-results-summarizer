const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const https = require("https");
const app = express();

const SEARXNG_URL = process.env.SEARXNG_URL || "http://localhost:8080";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "xiaomi/mimo-v2-flash:free";
const SUMMARY_ENABLED = process.env.SUMMARY_ENABLED !== "false";
const MAX_RESULTS = parseInt(process.env.MAX_RESULTS_FOR_SUMMARY) || 5;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

async function generateSummary(query, results) {
  if (!OPENROUTER_API_KEY || !SUMMARY_ENABLED) return null;

  try {
    const topResults = results.slice(0, MAX_RESULTS);
    const context = topResults.map((r, i) => `[${i + 1}] ${r.title}\n${r.content || r.url}`).join("\n\n");

    // Retry configuration
    const maxRetries = 3;
    const baseTimeout = 30000;

    // Force IPv4 with custom HTTPS agent
    const httpsAgent = new https.Agent({
      family: 4, // Force IPv4
      keepAlive: true,
      timeout: 60000,
    });

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await axios.post(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            model: OPENROUTER_MODEL,
            messages: [
              {
                role: "user",
                content: `Based on these search results for the query "${query}", provide a concise summary (2-3 paragraphs maximum) that answers the query:

${context}

Summary:`,
              },
            ],
            max_tokens: 500,
          },
          {
            headers: {
              Authorization: `Bearer ${OPENROUTER_API_KEY}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "http://localhost:3000",
              "X-Title": "SearXNG AI Proxy",
            },
            timeout: baseTimeout * attempt,
            httpsAgent: httpsAgent,
          },
        );

        return response.data.choices[0].message.content.trim();
      } catch (retryError) {
        if (attempt === maxRetries) {
          throw retryError;
        }

        // Wait before retrying (exponential backoff)
        const delayMs = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  } catch (error) {
    console.error("Summary generation failed:", error.message);
    return null;
  }
}

function injectSummary(html, summary, query) {
  if (!summary) return html;

  const summaryHTML = `
    <div style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
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
      <div style="color: #cbd5e1;
                  line-height: 1.6;
                  font-size: 15px;
                  white-space: pre-wrap;">${summary}</div>
      <div style="margin-top: 12px;
                  padding-top: 12px;
                  border-top: 1px solid #334155;
                  font-size: 12px;
                  color: #64748b;">
        Powered by ${OPENROUTER_MODEL.split("/")[1] || "AI"}
      </div>
    </div>`;

  // Rewrite main search form action to use proxy
  html = html.replace(/<form[^>]*id=["']search["'][^>]*>/gi, (match) => {
    return match.replace(/action=["']\/search["']/gi, 'action="/search"');
  });

  // Rewrite search form action and hrefs to use proxy
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
        try {
          const summary = await generateSummary(query, results);

          if (summary) {
            const enhancedHTML = injectSummary(html, summary, query);
            return res.status(response.status).send(enhancedHTML);
          }
        } catch (parseError) {
          console.error("Failed to generate summary:", parseError.message);
        }
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
  console.log(`🔍 Summary: ${SUMMARY_ENABLED ? "Enabled" : "Disabled"}`);
});
