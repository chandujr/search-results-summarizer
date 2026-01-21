const axios = require("axios");
const https = require("https");
const config = require("../settings");
const { log } = require("../utils/logger");

const httpsAgent = new https.Agent({
  family: 4,
  keepAlive: true,
  timeout: 60000,
});

function createAIPrompt(query, resultsText, dateToday) {
  return `You are a search assistant that summarizes search results based on today's date (${dateToday}).

  Important:
  - Use only information from provided sources
  - Be direct and factual; avoid speculation
  - Explain concepts clearly when needed
  - End definitively without questions or offers of further help
  - Keep response under ${config.MAX_TOKENS} tokens

  Summarize the search results for "${query}".

  Format:
  - For "what/how/explain" queries: explain concepts first
  - For technical queries: prioritize accuracy and direct answer without introductions
  - For current events: summarize key points and viewpoints
  - Note agreement/disagreement between sources
  - No hyperlinks or follow-up questions

  SOURCES:
  ${resultsText}`;
}

function getTodayDate() {
  return new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

async function handleStreamResponse(response, res) {
  log("Stream started");
  let chunkCount = 0;
  let buffer = "";

  try {
    for await (const chunk of response.data) {
      const chunkStr = Buffer.isBuffer(chunk) ? chunk.toString() : chunk.toString();
      buffer += chunkStr;

      // Process complete JSON lines
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const data = JSON.parse(line);

          // Check if streaming is complete
          if (data.done) {
            log(`Stream completed (${chunkCount} chunks)`);
            res.write(JSON.stringify({ done: true }) + "\n");
            res.end();
            return;
          }

          const content = data.response || "";
          if (content) {
            chunkCount++;
            res.write(JSON.stringify({ content }) + "\n");
          }
        } catch (parseError) {
          log(`Error parsing chunk: ${parseError.message}`);
          // Continue processing other chunks
        }
      }
    }

    // If we exit the loop without seeing done:true
    log(`Stream ended unexpectedly (${chunkCount} chunks)`);
    res.write(JSON.stringify({ done: true }) + "\n");
    res.end();
  } catch (error) {
    log("Error processing stream: " + error.message);
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
  if (!query || !results) {
    return res.status(400).json({ error: "Missing query or results" });
  }

  try {
    const topResults = results.slice(0, config.MAX_RESULTS_FOR_SUMMARY);
    const resultsText = topResults.map((r, i) => `[${i + 1}] ${r.title}\n${r.content || r.url}`).join("\n\n");
    const dateToday = getTodayDate();

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();

    log(`Summarizing from top ${topResults.length} results using Ollama`);

    const prompt = createAIPrompt(query, resultsText, dateToday);

    const requestData = {
      model: config.MODEL_ID,
      prompt: prompt,
      stream: true,
      think: false,
      options: {
        temperature: 0.6,
        top_p: 0.9,
        num_predict: config.MAX_TOKENS,
        top_k: 40,
        repeat_penalty: 1.1,
        stop: ["\n\n\n"],
      },
    };

    const response = await axios({
      method: "post",
      url: `${config.OLLAMA_URL}/api/generate`,
      data: requestData,
      responseType: "stream",
      // Only include httpsAgent if OLLAMA_URL uses HTTPS
      ...(config.OLLAMA_URL.startsWith("https") && { httpsAgent }),
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 120000, // 2 minute timeout for long responses
    });

    await handleStreamResponse(response, res);
  } catch (error) {
    handleStreamError(res, error);
  }
}

module.exports = {
  createSummaryStream,
};
