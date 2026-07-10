# Veritas coordinator — always-on container (NEVER serverless: it does
# post-response settlement work and holds in-flight round state).
# Build context = repo root:  docker build -f apps/coordinator/Dockerfile .
FROM node:22-slim

RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm exec turbo run build --filter=@veritas/coordinator

ENV NODE_ENV=production
ENV COORDINATOR_PORT=3001
EXPOSE 3001
WORKDIR /app/apps/coordinator

# Apply migrations on boot, then start the facilitator.
CMD ["sh", "-lc", "pnpm exec drizzle-kit migrate && node dist/server.js"]
