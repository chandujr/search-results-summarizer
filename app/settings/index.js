const path = require("path");
const fs = require("fs");
const yaml = require("js-yaml");

// Define required configuration properties
const requiredConfigProperties = [
  "ENGINE_NAME",
  "ENGINE_URL",
  "OPENROUTER_MODEL",
  "MAX_RESULTS_FOR_SUMMARY",
  "PORT",
  "HOST",
  "RATE_LIMIT_MS",
  "MAX_TOKENS",
  "EXCLUDE_WORDS",
  "EXCLUDE_OVERRIDES",
];

// Required environment variables
const requiredEnvVars = ["OPENROUTER_API_KEY"];

// Try to load configuration from file
const configFilePath = process.env.CONFIG_FILE_PATH || "/config/config.yaml";

// Load .env file if it exists
const envFilePath = "/config/.env";

// Read and parse .env file
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

// Load environment variables from .env file
const envVars = loadEnvFile(envFilePath);

// Set environment variables from .env file
Object.keys(envVars).forEach((key) => {
  process.env[key] = envVars[key];
});

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
  const missingProperties = requiredConfigProperties.filter((prop) => !(prop in fileConfig));
  if (missingProperties.length > 0) {
    throw new Error(`Missing required configuration properties: ${missingProperties.join(", ")}`);
  }

  // Check if all required environment variables are present
  const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);
  if (missingEnvVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingEnvVars.join(", ")}`);
  }

  config = fileConfig;
  config.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  console.log(`Configuration loaded from ${configFilePath}`);
  console.log(`Environment variables loaded from ${envFilePath}`);
} catch (error) {
  console.error(`Error loading configuration: ${error.message}`);
  process.exit(1);
}

// Add derived properties
config.MAX_RESULTS = config.MAX_RESULTS_FOR_SUMMARY;
config.TEMPLATES_PATH = path.join(__dirname, "../templates");
config.SEARXNG_TEMPLATE = path.join(__dirname, "../templates", "summary-template-searxng.html");
config.FOURGET_TEMPLATE = path.join(__dirname, "../templates", "summary-template-4get.html");

// Export the final configuration
module.exports = config;
