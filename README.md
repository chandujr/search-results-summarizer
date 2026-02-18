# Search Results Summarizer

AI-powered search results summary generator that works transparently with existing search engine instances (SearXNG and 4get) using multiple AI providers (OpenRouter and Ollama).


https://github.com/user-attachments/assets/cd004e9b-4f15-4835-ad79-20016964d6d5


## Installation

### Option 1: Using the Docker Image

#### Method A: With Docker Run

1. Create a configuration directory:
   ```bash
   mkdir -p ./search-results-summarizer/config
   cd ./search-results-summarizer
   ```

2. Run the container:
   ```bash
   docker run -d --name search-results-summarizer \
     -p 3000:3000 \
     -v "./config:/config" \
     --restart unless-stopped \
     ghcr.io/chandujr/search-results-summarizer:latest
   ```

3. Configure the service:
   ```bash
   # Edit the configuration files
   nano ./config/config.yaml
   nano ./config/.env
   ```

4. Restart the container to apply changes:
   ```bash
   docker restart search-results-summarizer
   ```

#### Method B: With Docker Compose

1. Create a project directory and docker-compose.yml:
   ```bash
   mkdir -p ./search-results-summarizer/config
   cd ./search-results-summarizer
   cat > docker-compose.yml << EOF
   services:
     search-results-summarizer:
       image: ghcr.io/chandujr/search-results-summarizer:latest
       container_name: search-results-summarizer
       ports:
         - "3000:3000"
       volumes:
         - ./config:/config
       restart: unless-stopped
   EOF
   ```

2. Start the service:
   ```bash
   docker-compose up -d
   ```

3. Configure the service:
   ```bash
   # Edit the configuration files
   nano ./config/config.yaml
   nano ./config/.env
   ```

4. Restart the service to apply changes:
   ```bash
   docker-compose restart
   ```

### Option 2: Using the Repository

1. Clone the repository:
   ```bash
   git clone https://github.com/chandujr/search-results-summarizer.git
   cd search-results-summarizer
   ```

2. Copy the configuration templates:
   ```bash
   cp config/config.yaml.default config/config.yaml
   cp config/.env.default config/.env
   ```

3. Edit your configuration:
   ```bash
   nano config/config.yaml
   nano config/.env
   ```

4. Build and run with Docker Compose:
   ```bash
   docker-compose up -d --build
   ```

## Configuration

In `config/.env`, set your API key based on your provider:
   ```
   # For OpenRouter
   OPENROUTER_API_KEY=your_api_key_here
   ```

In `config/config.yaml`, configure:

#### Search engine
- `ENGINE_NAME`: "searxng" or "4get"
- `ENGINE_URL`: URL of your search engine instance (see networking note below)
  - Works with both locally installed and public instances

#### AI configuration
- `AI_PROVIDER`: "openrouter" or "ollama"
- `MODEL_ID`: AI model ID to use for summarization
  - For OpenRouter: Find models at https://openrouter.ai/models
  - For Ollama: Find model names using `ollama list`
- `OLLAMA_URL`: Only required when using Ollama
- `MAX_TOKENS`: Maximum tokens for AI responses (default: 750)
- `CLASSIFICATION_MODEL_ID`: AI model to use for query classification in "smart" mode
  - Should be a smaller model that supports function/tool calling
  - For OpenRouter: models like "google/gemini-flash-1.5-8b" or similar
  - For Ollama: models that support tool calling like "llama3.1:8b" or similar

#### Performance
- `SUMMARY_MODE`: "auto" (automatic), "manual" (button-triggered), or "smart" (AI decides when to summarize)
- `MAX_RESULTS_FOR_SUMMARY`: Number of results to summarize (default: 7)
- `MAX_TOKENS`: Maximum tokens for AI responses (default: 750)

#### Connection
- `MODIFY_CSP_HEADERS`: Set to `true` if using public search engine instances that block external scripts (default: `false`)
- `TRUST_PROXY`: Set to `true` when running behind a reverse proxy - needed for proper rate limiting (default: `false`)
- `PROXY_IP_RANGE`: IP range of trusted proxy when TRUST_PROXY is enabled (default: "10.0.0.0/8" for Render)
- `RATE_LIMIT_MS`: Rate limit in milliseconds between requests (default: 1000)

#### Summarization Filters (only in "auto" mode)
- `MIN_KEYWORD_COUNT`: Minimum number of keywords required (default: 3)
- `MIN_RESULT_COUNT`: Minimum search results required (default: 3)
- `EXCLUDE_WORDS`: Words that prevent summarization
- `EXCLUDE_OVERRIDES`: Words that override the exclude list and force summarization

Note: The "smart" mode bypasses these filters and uses AI to determine if summarization is needed.

## Docker Networking Note

You may not be able to use `localhost` for `ENGINE_URL` or `OLLAMA_URL` since from within a Docker container, `localhost` refers to the container itself, not the host machine.

To connect to your installed services (search engine or Ollama) running on your host machine:

1. **Use the Docker network gateway IP**:
   ```bash
   # Find your Docker network name
   docker network ls | grep search-results-summarizer
   
   # Inspect the network to find the gateway IP
   docker network inspect <network_name> | grep Gateway
   # Example result: "Gateway": "172.19.0.1"
   # Set ENGINE_URL to: http://172.19.0.1:8081 (for search engine)
   # Set OLLAMA_URL to: http://172.19.0.1:11434 (for Ollama)
   ```

2. **Use your host machine's IP address**:
   ```bash
   # Find your host IP
   ip route get 1.1.1.1 | awk '{print $7}'
   # Example result: 192.168.1.100
   # Set ENGINE_URL to: http://192.168.1.100:8081 (for search engine)
   # Set OLLAMA_URL to: http://192.168.1.100:11434 (for Ollama)
   ```

## Usage

1. Access the service at `http://localhost:3000` (or your configured port) to verify it's working
2. Visit the service once, then you can set it as your default search engine through your browser's settings

Most modern browsers allow you to add this as a search engine.

## Privacy

- Summaries are generated by sending search query and results to your selected AI provider
- No data is stored by this proxy
- Consider privacy implications before use

## License

AGPL-3.0
