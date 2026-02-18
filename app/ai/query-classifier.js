const axios = require("axios");
const https = require("https");
const config = require("../settings");
const { log } = require("../utils/logger");

const CLASSIFICATION_TIMEOUT = 20000;

const httpsAgent = new https.Agent({
  family: 4,
  keepAlive: true,
  timeout: CLASSIFICATION_TIMEOUT,
});

const SYSTEM_PROMPT = `You are a query classifier. Determine if a search query needs AI summarization.

Queries that DON'T need summarization:
- Just a proper name (person, place, organization, brand, product)
- Single entity without context or questions
- Examples: "Taylor Swift", "Chicago", "iPhone 15", "Manchester United"

Queries that NEED summarization:
- Ask questions or seek specific information
- Have qualifying words (how, what, why, when, best, latest, vs, etc.)
- Request comparison or details
- Examples: "Taylor Swift tour dates", "Chicago weather", "iPhone 15 vs 16"`;

const TOOL_DEFINITION = {
  type: "function",
  function: {
    name: "classify_query",
    description: "Classify whether a search query needs AI summarization",
    parameters: {
      type: "object",
      properties: {
        needs_summary: {
          type: "boolean",
          description: "True if the query needs AI summarization, false if it's just a name/entity lookup",
        },
        reasoning: {
          type: "string",
          description: "Brief explanation of the classification decision",
        },
      },
      required: ["needs_summary"],
    },
  },
};

function parseToolCallResponse(toolCall) {
  try {
    const args =
      typeof toolCall.function.arguments === "string"
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function.arguments;

    // Handle both boolean and string "true"/"false"
    let needsSummary;
    if (typeof args.needs_summary === "boolean") {
      needsSummary = args.needs_summary;
    } else if (typeof args.needs_summary === "string") {
      needsSummary = args.needs_summary.toLowerCase() === "true";
    } else {
      log(`Unexpected needs_summary type: ${typeof args.needs_summary}`);
      return null;
    }

    if (args.reasoning) {
      log(`Classification: ${needsSummary ? "SUMMARIZE" : "SKIP"} - ${args.reasoning}`);
    }

    return needsSummary;
  } catch (error) {
    log(`Error parsing tool call arguments: ${error.message}`);
    return null;
  }
}

async function classifyQuery(query) {
  if (!config.CLASSIFIER_MODEL_ID) {
    log("No classification model configured, skipping classification");
    return null;
  }

  const isOpenRouter = config.SUMMARIZER_LLM_URL.includes("openrouter");

  if (isOpenRouter && !config.OPENROUTER_API_KEY) {
    log("OpenRouter API key missing for query classification");
    return null;
  }

  try {
    const response = await axios({
      method: "post",
      url: `${config.CLASSIFIER_LLM_URL}/chat/completions`,
      headers: {
        Authorization: `Bearer ${isOpenRouter ? config.OPENROUTER_API_KEY : "ollama"}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "search-results-summarizer",
        "X-Title": "Search Results Summarizer",
      },
      data: {
        model: config.CLASSIFIER_MODEL_ID,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: query },
        ],
        tools: [TOOL_DEFINITION],
        tool_choice: {
          type: "function",
          function: { name: "classify_query" },
        },
        temperature: 0,
      },
      ...(config.CLASSIFIER_LLM_URL.startsWith("https") && { httpsAgent }),
      timeout: CLASSIFICATION_TIMEOUT,
    });

    const toolCalls = response.data?.choices?.[0]?.message?.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      log("No tool calls in response");
      log("Classification failed, defaulting to SUMMARIZE for safety");
      return true;
    }

    return parseToolCallResponse(toolCalls[0]);
  } catch (error) {
    log(`Error classifying query: ${error.message}`);
    log("Classification failed, defaulting to SUMMARIZE for safety");
    return true;
  }
}

module.exports = {
  classifyQuery,
};
