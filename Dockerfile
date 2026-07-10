FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci

# Rebuild the source code only when
FROM base AS builder
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generate prisma client before building Next.js
RUN npx prisma generate
RUN npm run build

# Production image, copy all the files and run
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Install openssl for Prisma and bash for the local terminal adapter
RUN apk add --no-cache openssl bash

# Copy Next.js artifacts (using wildcard so it doesn't crash if the public folder is empty/missing from Git)
COPY --from=builder /app/publi[c] ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy worker/jobs and dependencies needed for the background worker
COPY --from=builder /app/worker ./worker
COPY --from=builder /app/jobs ./jobs
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/types ./types
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Web server port
EXPOSE 3000
# Terminal websocket port
EXPOSE 3001

CMD ["node", "server.js"]
