const OpenAI = require("openai");
const https = require("https");
const config = require("../settings");
const { log } = require("../utils/logger");

const httpsAgent = new https.Agent({
  family: 4,
  keepAlive: true,
  timeout: 60000,
});

function getOpenRouterClient(refererUrl) {
  if (!config.OPENROUTER_API_KEY) {
    throw new Error("OpenRouter API key is missing");
  }

  return new OpenAI({
    apiKey: config.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "X-Title": "Search Results Summarizer",
      "HTTP-Referer": refererUrl,
    },
    httpAgent: httpsAgent,
    timeout: 60000,
    maxRetries: 3,
  });
}

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
      - For technical queries: prioritize accuracy and direct answer without introductions
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

  try {
    for await (const chunk of stream) {
      const content = chunk.choices?.[0]?.delta?.content || "";

      if (content) {
        chunkCount++;
        res.write(JSON.stringify({ content }) + "\n");
      }
    }

    log(`Stream completed (${chunkCount} chunks)`);
    res.write(JSON.stringify({ done: true }) + "\n");
    res.end();
  } catch (error) {
    log(`Stream processing error: ${error.message}`);
    throw error;
  }
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
    const refererUrl = config.getExternalUrl(req);
    log(`Using referer URL: ${refererUrl}`);

    const topResults = results.slice(0, config.MAX_RESULTS_FOR_SUMMARY);
    const resultsText = topResults.map((r, i) => `[${i + 1}] ${r.title}\n${r.content || r.url}`).join("\n\n");
    const dateToday = getTodayDate();

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();

    log(`Summarizing from top ${topResults.length} results`);

    const prompt = createAIPrompt(query, resultsText, dateToday);

    const openrouter = getOpenRouterClient(refererUrl);

    const stream = await openrouter.chat.completions.create({
      model: config.MODEL_ID,
      messages: prompt,
      max_tokens: config.MAX_TOKENS,
      temperature: 0.6,
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
