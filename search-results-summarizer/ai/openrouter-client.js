const OpenAI = require("openai");
const https = require("https");
const config = require("../config");
const { log } = require("../utils/logger");

// Force IPv4 for all HTTPS requests to avoid connection issues
const httpsAgent = new https.Agent({
  family: 4,
  keepAlive: true,
  timeout: 60000,
});

// Initialize OpenRouter client with IPv4 agent
const openrouter = new OpenAI({
  apiKey: config.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "http://localhost:3000",
    "X-Title": "Search Results Summarizer",
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

      IMPORTANT: Your response must not exceed ${config.MAX_TOKENS} tokens. Be concise and prioritize the most important information.`,
    },
    {
      role: "user",
      content: `QUERY:
      ${query}

      Below are search results relevant to the query.

      TASK:
      Produce a helpful search-style response similar to a modern search engine.

      IMPORTANT: Limit your response to ${config.MAX_TOKENS} tokens maximum.

      GUIDELINES:
      - If the query asks "what is / how does / explain", provide a clear explanation first
      - If the query is technical, prioritize accuracy, definitions, and examples
      - If the query is about current events, summarize key points and viewpoints
      - If multiple sources agree on facts, state them directly
      - If sources disagree, note the disagreement
      - Use only the information in the sources
      - Do not add non-secure hyperlinks in the summary
      - For any date-related calculations or age calculations, use today's date ${dateToday}

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

async function createSummaryStream(query, results, res) {
  if (!config.OPENROUTER_API_KEY || !config.SUMMARY_ENABLED) {
    log("Summary not enabled or API key missing");
    return res.status(400).json({ error: "Summary not enabled or API key missing" });
  }

  if (!query || !results) {
    return res.status(400).json({ error: "Missing query or results" });
  }

  try {
    const topResults = results.slice(0, config.MAX_RESULTS);
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
    });

    await handleStreamResponse(stream, res);
  } catch (error) {
    handleStreamError(res, error);
  }
}

module.exports = {
  createSummaryStream,
};
