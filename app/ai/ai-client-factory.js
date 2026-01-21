const config = require("../settings");
const openrouterClient = require("./openrouter-client");
const ollamaClient = require("./ollama-client");
const { log } = require("../utils/logger");

function getAIClient() {
  if (config.AI_PROVIDER === "ollama") {
    log("Using Ollama AI client");
    return ollamaClient;
  } else {
    log("Using OpenRouter AI client");
    return openrouterClient;
  }
}

module.exports = {
  getAIClient,
};
