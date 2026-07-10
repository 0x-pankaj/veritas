# Veritas live demo UI (Next.js) — verified vs naive x402, side by side.
# Build context = repo root:  docker build -f apps/demo/Dockerfile .
FROM node:22-slim

RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm exec turbo run build --filter=@veritas/demo

ENV NODE_ENV=production
EXPOSE 3002
WORKDIR /app/apps/demo
CMD ["pnpm", "start"]
