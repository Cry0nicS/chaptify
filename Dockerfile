# syntax=docker/dockerfile:1

# === Build Stage ===
# Pin the Alpine minor so the FFmpeg/ffprobe build shipped in the runtime stage is reproducible.
FROM node:22-alpine3.24 AS builder
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --prefer-offline --ignore-scripts

# Then copy everything else
COPY . .

RUN npm run postinstall
RUN npm run build


# === Production Stage ===
FROM node:22-alpine3.24 AS production
WORKDIR /app

# Set runtime environment
ENV NODE_ENV=production
ENV NUXT_STORAGE_ROOT=/data/chaptify

# Install only production dependencies
RUN apk add --no-cache ffmpeg python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev --prefer-offline --ignore-scripts
RUN npm rebuild better-sqlite3

# Copy production build artifacts
COPY --from=builder /app/.output .output
COPY --from=builder /app/public ./public
RUN mkdir -p .output/server/node_modules/better-sqlite3/build \
    && cp -R node_modules/better-sqlite3/build/Release .output/server/node_modules/better-sqlite3/build/

# Use non-root user for security
RUN addgroup -S appgroup \
    && adduser -S appuser -G appgroup \
    && mkdir -p /data/chaptify \
    && chown -R appuser:appgroup /data/chaptify /app
USER appuser

EXPOSE 3000
VOLUME ["/data/chaptify"]

CMD ["node", ".output/start.mjs"]
