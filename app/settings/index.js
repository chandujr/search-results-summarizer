const path = require("path");
const fs = require("fs");
const yaml = require("js-yaml");

const requiredConfigProperties = [
  "ENGINE_NAME",
  "ENGINE_URL",
  "AI_PROVIDER",
  "MODEL_ID",
  "OLLAMA_URL",
  "MAX_TOKENS",
  "RATE_LIMIT_MS",
  "SUMMARY_MODE",
  "MAX_RESULTS_FOR_SUMMARY",
  "MODIFY_CSP_HEADERS",
  "TRUST_PROXY",
  "PROXY_IP_RANGE",
  "MIN_KEYWORD_COUNT",
  "MIN_RESULT_COUNT",
  "EXCLUDE_WORDS",
  "EXCLUDE_OVERRIDES",
];

const configFilePath = process.env.CONFIG_FILE_PATH || "/config/config.yaml";
const envFilePath = "/config/.env";

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const envVars = {};
  const envFileContent = fs.readFileSync(filePath, "utf8");

  envFileContent.split("\n").forEach((line) => {
    // Skip empty lines and comments
    if (!line.trim() || line.startsWith("#")) return;

    const [key, value] = line.split("=");
    if (key && value) {
      envVars[key.trim()] = value.trim();
    }
  });

  return envVars;
};

const envVars = loadEnvFile(envFilePath);

if (Object.keys(envVars).length > 0) {
  Object.keys(envVars).forEach((key) => {
    if (!process.env[key]) {
      process.env[key] = envVars[key];
    }
  });
}

let config;

try {
  if (!fs.existsSync(configFilePath)) {
    throw new Error(`Configuration file not found at ${configFilePath}`);
  }

  const fileContent = fs.readFileSync(configFilePath, "utf8");
  let fileConfig;

  try {
    fileConfig = yaml.load(fileContent);
  } catch (yamlError) {
    throw new Error(`YAML parsing error: ${yamlError.message}`);
  }

  // Check if all required properties are present
  const missingProperties = requiredConfigProperties.filter((prop) => !(prop in fileConfig) && !process.env[prop]);
  if (missingProperties.length > 0) {
    throw new Error(`Missing required configuration properties: ${missingProperties.join(", ")}`);
  }

  // Check if all required environment variables are present based on AI provider
  const aiProvider = fileConfig.AI_PROVIDER || process.env.AI_PROVIDER;
  let missingEnvVars = [];

  if (aiProvider === "openrouter") {
    missingEnvVars = ["OPENROUTER_API_KEY"].filter((envVar) => !process.env[envVar]);
  }

  if (missingEnvVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingEnvVars.join(", ")}`);
  }

  config = fileConfig;

  if (typeof config.EXCLUDE_WORDS === "string") {
    config.EXCLUDE_WORDS = config.EXCLUDE_WORDS.split(",");
  }
  if (typeof config.EXCLUDE_OVERRIDES === "string") {
    config.EXCLUDE_OVERRIDES = config.EXCLUDE_OVERRIDES.split(",");
  }

  // Only add OpenRouter API key if using OpenRouter
  if (config.AI_PROVIDER === "openrouter") {
    config.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  }

  // Override config properties with environment variables if they exist
  requiredConfigProperties.forEach((prop) => {
    if (process.env[prop]) {
      config[prop] = process.env[prop];

      if (
        prop === "RATE_LIMIT_MS" ||
        prop === "MAX_TOKENS" ||
        prop === "MAX_RESULTS_FOR_SUMMARY" ||
        prop === "MIN_KEYWORD_COUNT" ||
        prop === "MIN_RESULT_COUNT"
      ) {
        config[prop] = parseInt(config[prop], 10);
      } else if (prop === "MODIFY_CSP_HEADERS") {
        config[prop] = config[prop] === "true" || config[prop] === "1";
      } else if (prop === "TRUST_PROXY") {
        config[prop] = config[prop] === "true" || config[prop] === "1";
      } else if (prop === "EXCLUDE_WORDS" || prop === "EXCLUDE_OVERRIDES") {
        config[prop] = process.env[prop].split(",");
      }
    }
  });
  console.log(`Configuration loaded from ${configFilePath}`);
  console.log(`Environment variables loaded`);
} catch (error) {
  console.error(`Error loading configuration: ${error.message}`);
  process.exit(1);
}

// Add derived properties
config.PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
config.HOST = process.env.HOST || "0.0.0.0";
config.TEMPLATES_PATH = path.join(__dirname, "../templates");
config.SEARXNG_TEMPLATE = path.join(__dirname, "../templates", "summary-template-searxng.html");
config.FOURGET_TEMPLATE = path.join(__dirname, "../templates", "summary-template-4get.html");

// Function to get the external URL based on request
config.getExternalUrl = (req) => {
  // Check if we're behind a proxy and use the forwarded host if available
  const host = req.get("X-Forwarded-Host") || req.get("Host") || "localhost";
  const protocol = req.get("X-Forwarded-Proto") || req.protocol;

  // Extract just the host:port part without any path
  const hostPort = host.split("/")[0];

  return `${protocol}://${hostPort}`;
};

// Export the final configuration
module.exports = config;
