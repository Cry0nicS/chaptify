# syntax=docker/dockerfile:1

# === Build Stage ===
# Pin the Alpine minor so the FFmpeg/ffprobe build shipped in the runtime stage is reproducible.
FROM node:24-alpine3.24 AS builder
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --prefer-offline --ignore-scripts

# Then copy everything else
COPY . .

RUN npm run postinstall
RUN npm run build


# === Production Dependencies Stage ===
# Needs the C toolchain to compile better-sqlite3, but nothing from this stage ships except the
# finished node_modules tree — the toolchain stays out of the runtime image.
FROM node:24-alpine3.24 AS deps
WORKDIR /app

RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev --prefer-offline --ignore-scripts
RUN npm rebuild better-sqlite3


# === Production Stage ===
FROM node:24-alpine3.24 AS production
WORKDIR /app

# Set runtime environment
ENV NODE_ENV=production
ENV NUXT_STORAGE_ROOT=/data/chaptify

# FFmpeg is the only extra runtime requirement; dependencies are prebuilt in the deps stage.
RUN apk add --no-cache ffmpeg

# Drop npm from the RUNTIME image only — the builder and deps stages above still need it, and this
# stage never invokes it: every entrypoint is `node .output/<name>.mjs` and the healthcheck is
# `node -e`. What ships in `node:24-alpine3.24` is npm's own bundled dependency tree, which is not
# ours to patch and moves only when the base image ships a newer npm. Leaving it in meant the
# vulnerability gate reported CVEs in a package manager that can never run here — findings with no
# action attached, which is exactly what trains an operator to stop reading the gate. Removing it also
# takes a package manager and arbitrary-code-fetching tool out of a container that processes untrusted
# media.
#
# This does not shrink the image: the files live in the base layer and a later `rm` only writes
# whiteouts over them. It removes them from the final filesystem, which is what both the scanner and
# an attacker see. `corepack` and `yarn` are also present in the base image and equally unused, but
# neither currently carries a finding, so they are left alone rather than trimmed on spec.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY package*.json ./
COPY --from=deps /app/node_modules ./node_modules

# Copy production build artifacts
COPY --from=builder /app/.output .output
COPY --from=builder /app/public ./public
RUN mkdir -p .output/server/node_modules/better-sqlite3/build \
    && cp -R node_modules/better-sqlite3/build/Release .output/server/node_modules/better-sqlite3/build/

# Use non-root user for security. Only the storage path is handed to appuser: /app stays
# root-owned and is not writable by the runtime user, so a compromised process cannot rewrite the
# application's own code even if the container is started without a read-only root filesystem.
RUN addgroup -S appgroup \
    && adduser -S appuser -G appgroup \
    && mkdir -p /data/chaptify \
    && chown -R appuser:appgroup /data/chaptify
USER appuser

EXPOSE 3000
VOLUME ["/data/chaptify"]

CMD ["node", ".output/start.mjs"]
