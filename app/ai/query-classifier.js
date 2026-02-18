const axios = require("axios");
const https = require("https");
const config = require("../settings");
const { log } = require("../utils/logger");

const CLASSIFICATION_TIMEOUT = 20000; // 10 seconds is enough for classification

const httpsAgent = new https.Agent({
  family: 4,
  keepAlive: true,
  timeout: CLASSIFICATION_TIMEOUT, // Reduced for classification
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

// Helper function to parse tool call response
function parseToolCallResponse(toolCall, source) {
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
      log(`[${source}] Unexpected needs_summary type: ${typeof args.needs_summary}`);
      return null;
    }

    if (args.reasoning) {
      log(`[${source}] Classification: ${needsSummary ? "SUMMARIZE" : "SKIP"} - ${args.reasoning}`);
    }

    return needsSummary;
  } catch (error) {
    log(`[${source}] Error parsing tool call arguments: ${error.message}`);
    return null;
  }
}

// Function to determine if a query needs summarization using OpenRouter
async function classifyQueryOpenRouter(query) {
  if (!config.OPENROUTER_API_KEY) {
    log("OpenRouter API key missing for query classification");
    return null; // Return null to indicate error, not false
  }

  try {
    const response = await axios({
      method: "post",
      url: "https://openrouter.ai/api/v1/chat/completions",
      headers: {
        Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "search-results-summarizer",
        "X-Title": "Search Results Summarizer",
      },
      data: {
        model: config.CLASSIFICATION_MODEL_ID,
        messages: [
          {
            role: "system",
            content: SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: query,
          },
        ],
        tools: [TOOL_DEFINITION],
        tool_choice: {
          type: "function",
          function: { name: "classify_query" },
        },
        temperature: 0,
      },
      httpsAgent,
      timeout: CLASSIFICATION_TIMEOUT,
    });

    const toolCalls = response.data?.choices?.[0]?.message?.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      log("[OpenRouter] No tool calls in response");
      return null;
    }

    return parseToolCallResponse(toolCalls[0], "OpenRouter");
  } catch (error) {
    log(`[OpenRouter] Error classifying query: ${error.message}`);
    return null;
  }
}

// Function to determine if a query needs summarization using Ollama
async function classifyQueryOllama(query) {
  try {
    const response = await axios({
      method: "post",
      url: `${config.OLLAMA_URL}/api/chat`,
      headers: {
        "Content-Type": "application/json",
      },
      data: {
        model: config.CLASSIFICATION_MODEL_ID,
        messages: [
          {
            role: "system",
            content: SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: query,
          },
        ],
        tools: [TOOL_DEFINITION],
        // Note: Ollama may not support tool_choice, but include it for models that do
        stream: false,
        options: {
          temperature: 0,
        },
      },
      ...(config.OLLAMA_URL.startsWith("https") && { httpsAgent }),
      timeout: CLASSIFICATION_TIMEOUT,
    });

    const message = response.data?.message;
    if (!message) {
      log("[Ollama] No message in response");
      return null;
    }

    // Primary: Check for tool call response
    if (message.tool_calls && message.tool_calls.length > 0) {
      return parseToolCallResponse(message.tool_calls[0], "Ollama");
    }

    // Fallback: Try to parse content as JSON (some Ollama models return JSON directly)
    if (message.content) {
      try {
        const content = typeof message.content === "string" ? JSON.parse(message.content) : message.content;

        let needsSummary;
        if (typeof content.needs_summary === "boolean") {
          needsSummary = content.needs_summary;
        } else if (typeof content.needs_summary === "string") {
          needsSummary = content.needs_summary.toLowerCase() === "true";
        } else {
          log("[Ollama] Invalid needs_summary type in content");
          return null;
        }

        if (content.reasoning) {
          log(`[Ollama] Classification: ${needsSummary ? "SUMMARIZE" : "SKIP"} - ${content.reasoning}`);
        }
        return needsSummary;
      } catch (parseError) {
        log(`[Ollama] Content is not valid JSON: ${parseError.message}`);
      }
    }

    log("[Ollama] Could not extract classification from response");
    return null;
  } catch (error) {
    log(`[Ollama] Error classifying query: ${error.message}`);
    return null;
  }
}

// Main function to classify query based on the configured AI provider
async function classifyQuery(query) {
  if (!config.CLASSIFICATION_MODEL_ID) {
    log("No classification model configured, skipping classification");
    return null;
  }

  let result;

  if (config.AI_PROVIDER === "openrouter") {
    result = await classifyQueryOpenRouter(query);
  } else if (config.AI_PROVIDER === "ollama") {
    result = await classifyQueryOllama(query);
  } else {
    log(`Unsupported AI provider for query classification: ${config.AI_PROVIDER}`);
    return null;
  }

  // If classification failed (null), default to summarizing to be safe
  if (result === null) {
    log("Classification failed, defaulting to SUMMARIZE for safety");
    return true; // Better to summarize when uncertain
  }

  return result;
}

module.exports = {
  classifyQuery,
};
