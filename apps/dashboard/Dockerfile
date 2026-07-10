# Veritas dashboard + truth-ledger explorer (Next.js). Stateless read surface
# over the coordinator's Postgres mirror.
# Build context = repo root:  docker build -f apps/dashboard/Dockerfile .
FROM node:22-slim

RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm exec turbo run build --filter=@veritas/dashboard

ENV NODE_ENV=production
EXPOSE 3003
WORKDIR /app/apps/dashboard
CMD ["pnpm", "start"]
