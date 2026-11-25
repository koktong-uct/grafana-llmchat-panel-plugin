# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src/ ./src/
USER node
CMD ["node", "--env-file-if-exists=.env", "src/index.ts"]

# This explicit target ships the deployment credentials in the image.
FROM base AS packaged
USER root
RUN --mount=type=secret,id=backend_env,required=true \
    --mount=type=secret,id=grafana_ca,required=true \
    install -m 0400 -o node -g node /run/secrets/backend_env /app/.env && \
    install -m 0444 /run/secrets/grafana_ca /app/grafana-ca.pem
ENV CHAT_HOST=0.0.0.0 \
    GRAFANA_TLS_CA_FILE=/app/grafana-ca.pem
USER node

FROM base AS runtime
