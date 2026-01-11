const OpenAI = require("openai");
const https = require("https");
const config = require("../settings");
const { log } = require("../utils/logger");

// Force IPv4 for all HTTPS requests to avoid connection issues
const httpsAgent = new https.Agent({
  family: 4,
  keepAlive: true,
  timeout: 60000,
});

// Initialize OpenRouter client with IPv4 agent
// Note: HTTP-Referer will be dynamically set based on the request in createSummaryStream
const openrouter = new OpenAI({
  apiKey: config.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "X-Title": "Search Results Summarizer",
  },
  httpAgent: httpsAgent,
});

function createAIPrompt(query, resultsText, dateToday) {
  return [
    {
      role: "system",
      content: `You are a search assistant that summarizes search results based on today's date (${dateToday}).

      Guidelines:
      - Use only information from provided sources
      - Be direct and factual; avoid speculation
      - Explain concepts clearly when needed
      - End definitively without questions or offers of further help
      - Keep response under ${config.MAX_TOKENS} tokens`,
    },
    {
      role: "user",
      content: `Summarize the search results for "${query}".

      Format:
      - For "what/how/explain" queries: explain concepts first
      - For technical queries: prioritize accuracy and definitions
      - For current events: summarize key points and viewpoints
      - Note agreement/disagreement between sources
      - No hyperlinks or follow-up questions

      SOURCES:
      ${resultsText}`,
    },
  ];
}

function getTodayDate() {
  return new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

async function handleStreamResponse(stream, res) {
  log("Stream started");
  let chunkCount = 0;

  for await (const chunk of stream) {
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

async function createSummaryStream(query, results, res, req) {
  if (!config.OPENROUTER_API_KEY) {
    log("API key missing");
    return res.status(400).json({ error: "API key missing" });
  }

  if (!query || !results) {
    return res.status(400).json({ error: "Missing query or results" });
  }

  try {
    // Set the HTTP-Referer header dynamically based on the request
    const refererUrl = config.getExternalUrl(req);
    log(`Using referer URL: ${refererUrl}`);
    const topResults = results.slice(0, config.MAX_RESULTS_FOR_SUMMARY);
    const resultsText = topResults
      .map((r, i) => {
        // Strip HTML tags from content to improve AI summarization
        const originalContent = r.content || r.url;
        const cleanContent = originalContent.replace(/<[^>]*>?/g, "");
        return `[${i + 1}] ${r.title}\n${cleanContent}`;
      })
      .join("\n\n");
    const dateToday = getTodayDate();

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();

    log(`Summarizing from top ${topResults.length} results`);

    const prompt = createAIPrompt(query, resultsText, dateToday);
    const stream = await openrouter.chat.completions.create({
      model: config.OPENROUTER_MODEL,
      messages: prompt,
      max_tokens: config.MAX_TOKENS,
      stream: true,
      headers: {
        "HTTP-Referer": refererUrl,
      },
    });

    await handleStreamResponse(stream, res);
  } catch (error) {
    handleStreamError(res, error);
  }
}

module.exports = {
  createSummaryStream,
};
