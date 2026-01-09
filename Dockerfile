FROM node:20-alpine

WORKDIR /app

COPY ./app/package*.json ./

RUN npm install --production

COPY ./app/server.js ./
COPY ./app/settings ./settings
COPY ./app/services ./services
COPY ./app/utils ./utils
COPY ./app/ai ./ai
COPY ./app/templates ./templates
COPY ./config/config.yaml.default /config/config.yaml.default
COPY ./config/.env.default /config/.env.default
COPY ./scripts/start.sh /scripts/
RUN chmod +x /scripts/start.sh
RUN mkdir -p /config

EXPOSE 3000

CMD ["/scripts/start.sh"]
