FROM oven/bun:1.3-alpine

WORKDIR /app

COPY package.json bun.lock* ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN bun install --frozen-lockfile

COPY backend ./backend

ENV NODE_ENV=production
ENV PORT=3001
ENV CORS_ORIGIN=http://localhost:3000

EXPOSE 3001

CMD ["bun", "run", "backend/src/index.ts"]
