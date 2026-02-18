const openaiClient = require("./openai-client");
const { log } = require("../utils/logger");

function getAIClient() {
  log("Using OpenAI compatible client");
  return openaiClient;
}

module.exports = {
  getAIClient,
};
