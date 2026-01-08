# Docker Commands

## Build the Docker Image

```bash
docker build -t search-results-summarizer .
```

## Run the Container

### With Configuration Files

The application requires two configuration files:
1. `config.json` - Application configuration
2. `.env` - Environment variables (including API key)

```bash
# Create a config directory
mkdir -p config

# Run the container with the mounted config directory
docker run -p 3000:3000 -v $(pwd)/config:/config search-results-summarizer
```

If the configuration files don't exist in your mounted directory, the container will copy default template files there for you to customize:

1. Edit `config/config.json` to configure the application settings
2. Edit `config/.env` to set your OPENROUTER_API_KEY

After editing, restart the container to apply the changes:
```bash
docker restart search-results-summarizer
```

## Container Management

### View Logs

```bash
docker logs search-results-summarizer
```

### Stop the Container

```bash
docker stop search-results-summarizer
```

### Remove the Container

```bash
docker rm search-results-summarizer
```
