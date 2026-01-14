#!/bin/sh

CONFIG_DIR="/config"
CONFIG_FILE="${CONFIG_DIR}/config.yaml"
DEFAULT_CONFIG_FILE="/app/defaults/config.yaml.default"
ENV_FILE="${CONFIG_DIR}/.env"
DEFAULT_ENV_FILE="/app/defaults/.env.default"

# Check if config directory exists and is writable
if [ -d "$CONFIG_DIR" ] && [ -w "$CONFIG_DIR" ]; then
    echo "Volume mount detected - using $CONFIG_DIR directory"

    # Create config file if it doesn't exist
    if [ ! -f "$CONFIG_FILE" ]; then
        echo "No config file found in $CONFIG_DIR. Copying default configuration..."
        cp "$DEFAULT_CONFIG_FILE" "$CONFIG_FILE"
        echo "Default configuration copied to $CONFIG_DIR"
    fi

    # Create .env file if it doesn't exist
    if [ ! -f "$ENV_FILE" ]; then
        echo "No .env file found in $CONFIG_DIR. Copying default environment template..."
        cp "$DEFAULT_ENV_FILE" "$ENV_FILE"
        echo "Default environment template copied to $ENV_FILE"
    fi

    export CONFIG_FILE_PATH="$CONFIG_FILE"
else
    echo "Volume mount not detected - using environment variables for configuration"

    # for Render
    if [ -f "/etc/secrets/config.yaml" ]; then
        echo "Using Render secret config file"
        export CONFIG_FILE_PATH="/etc/secrets/config.yaml"
    else
        # Try multiple locations for config files
        if [ -d "/tmp" ] && [ -w "/tmp" ]; then
            CONFIG_DIR="/tmp/config"
            echo "Using /tmp/config directory"
        # Try current working directory
        elif [ -w "." ]; then
            CONFIG_DIR="./config"
            echo "Using ./config directory"
        # Last resort - use /app directory
        else
            CONFIG_DIR="/app/config"
            echo "Using /app/config directory"
        fi

        CONFIG_FILE="${CONFIG_DIR}/config.yaml"
        mkdir -p "$CONFIG_DIR"
        cp "$DEFAULT_CONFIG_FILE" "$CONFIG_FILE"
        export CONFIG_FILE_PATH="$CONFIG_FILE"
    fi
fi

exec npm start
