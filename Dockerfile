# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS builder

ENV NEXT_TELEMETRY_DISABLED=1

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ARG ORBIT_VERSION=dev

LABEL org.opencontainers.image.title="Orbit Finance" \
      org.opencontainers.image.description="Local-first personal finance app backed by PostgreSQL." \
      org.opencontainers.image.source="https://github.com/andreasawires/orbit-finance" \
      org.opencontainers.image.url="https://github.com/andreasawires/orbit-finance" \
      org.opencontainers.image.version="${ORBIT_VERSION}" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    IMPORT_STORAGE_PATH=/app/data/imports \
    INSTALL_METHOD=docker

# Poppler renders only the PDF pages that pdf-inspector marks for visual parsing.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder --chown=node:node /app /app
RUN mkdir -p /app/data/imports \
    && chown -R node:node /app/data

USER node

EXPOSE 3000

CMD ["npm", "run", "start"]
