const OpenAI = require("openai");
const https = require("https");
const config = require("../config");
const { log } = require("../utils/logger");

// Force IPv4 for all HTTPS requests
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
    "X-Title": "SearXNG AI Proxy",
  },
  httpAgent: httpsAgent,
});

/**
 * Create AI prompt for summarization
 * @param {string} query - Search query
 * @param {string} resultsText - Text of search results
 * @param {string} dateToday - Today's date
 * @returns {Array} - Array of messages for the AI
 */
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
      - Do not add hyperlinks in the summary
      - For any date-related calculations or age calculations, use today's date ${dateToday}

      SOURCES:
      ${resultsText}`,
    },
  ];
}

/**
 * Get today's date in a readable format
 * @returns {string} - Formatted date string
 */
function getTodayDate() {
  return new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Handle streaming response from OpenRouter
 * @param {Object} stream - Stream from OpenRouter
 * @param {Object} res - Express response object
 */
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

/**
 * Handle streaming errors
 * @param {Object} res - Express response object
 * @param {Error} error - Error object
 */
function handleStreamError(res, error) {
  log("Streaming error: " + error.message);

  if (!res.headersSent) {
    res.status(500).json({ error: error.message || "Unknown error" });
  } else {
    res.write(JSON.stringify({ error: error.message || "Unknown error" }) + "\n");
    res.end();
  }
}

/**
 * Create a streaming completion for summarizing search results
 * @param {string} query - Search query
 * @param {Array} results - Array of search results
 * @param {Object} res - Express response object
 */
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
    const resultsText = topResults.map((r, i) => `[${i + 1}] ${r.title}\n${r.content || r.url}`).join("\n\n");
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
