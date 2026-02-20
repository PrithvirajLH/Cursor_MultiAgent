# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS deps
WORKDIR /app

COPY package*.json ./
COPY apps/api/package*.json apps/api/
COPY apps/web/package*.json apps/web/
RUN npm ci

FROM deps AS builder
WORKDIR /app

COPY . .

RUN npm run build -w apps/api \
  && npm run build -w apps/web \
  && mkdir -p apps/api/public \
  && cp -r apps/web/dist/. apps/api/public/

RUN npm run -w apps/api db:generate
RUN npm prune --omit=dev

FROM node:20-bookworm-slim AS runner
WORKDIR /app/apps/api

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/apps/api/package.json ./package.json
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/prisma ./prisma
COPY --from=builder /app/apps/api/public ./public

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/src/main.js"]
