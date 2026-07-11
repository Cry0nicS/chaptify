# syntax=docker/dockerfile:1

# === Build Stage ===
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci --prefer-offline

# Then copy everything else
COPY . .

RUN npm run build


# === Production Stage ===
FROM node:22-alpine AS production
WORKDIR /app

# Set runtime environment
ENV NODE_ENV=production

# Install only production dependencies
COPY package*.json ./
RUN npm ci --only=production --prefer-offline --ignore-scripts

# Copy production build artifacts
COPY --from=builder /app/.output .output
COPY --from=builder /app/public ./public

# Use non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
