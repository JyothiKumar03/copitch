FROM oven/bun:1.3-alpine

WORKDIR /app

COPY package.json bun.lock tsconfig.base.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN bun install --frozen-lockfile --production --filter @equal-ai/api

COPY shared ./shared
COPY backend/src ./backend/src
COPY backend/tsconfig.json ./backend/tsconfig.json

ENV NODE_ENV=production
ENV PORT=3001
ENV CORS_ORIGIN=http://localhost:3000

EXPOSE 3001

CMD ["bun", "run", "backend/src/index.ts"]
