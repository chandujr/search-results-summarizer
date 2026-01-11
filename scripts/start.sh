#!/bin/sh

CONFIG_DIR="/config"
CONFIG_FILE="${CONFIG_DIR}/config.yaml"
DEFAULT_CONFIG_FILE="/app/defaults/config.yaml.default"
ENV_FILE="${CONFIG_DIR}/.env"
DEFAULT_ENV_FILE="/app/defaults/.env.default"

mkdir -p "$CONFIG_DIR"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "No config file found in $CONFIG_DIR. Copying default configuration..."
    cp "$DEFAULT_CONFIG_FILE" "$CONFIG_FILE"
    echo "Default configuration copied to $CONFIG_FILE"
    echo "Please edit this file to customize your settings."
fi

if [ ! -f "$ENV_FILE" ]; then
    echo "No .env file found in $CONFIG_DIR. Copying default environment template..."
    cp "$DEFAULT_ENV_FILE" "$ENV_FILE"
    echo "Default environment template copied to $ENV_FILE"
    echo "Please edit this file to set your OPENROUTER_API_KEY."
fi

export CONFIG_FILE_PATH="$CONFIG_FILE"

exec npm start
